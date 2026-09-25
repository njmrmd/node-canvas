import { ApiError } from './api-error';
import { CURRENT_KEY_VERSION, maskedSuffix, openApiKey, sealApiKey } from './crypto/vault';
import { query, queryOne } from './db';

/** The one provider. Part of the AAD — changing it makes every stored key unreadable. */
const PROVIDER = 'anthropic';

export type KeySummary = { last4: string; updatedAt: string };

export async function getKeySummary(userId: string): Promise<KeySummary | null> {
	const row = await queryOne<{ last4: string; updated_at: Date }>(
		'select last4, updated_at from provider_keys where user_id = $1',
		[userId]
	);
	return row ? { last4: row.last4, updatedAt: row.updated_at.toISOString() } : null;
}

export async function saveKey(userId: string, apiKey: string): Promise<KeySummary> {
	const sealed = sealApiKey(apiKey, userId, PROVIDER);
	const row = await queryOne<{ updated_at: Date }>(
		`insert into provider_keys (user_id, ciphertext, iv, tag, last4)
		      values ($1, $2, $3, $4, $5)
		 on conflict (user_id) do update
		        set ciphertext = excluded.ciphertext, iv = excluded.iv, tag = excluded.tag,
		            last4 = excluded.last4, updated_at = now()
		  returning updated_at`,
		[userId, sealed.ciphertext, sealed.iv, sealed.authTag, maskedSuffix(apiKey)]
	);
	if (!row) throw new ApiError('internal_error', 'Could not save that key.');
	return { last4: maskedSuffix(apiKey), updatedAt: row.updated_at.toISOString() };
}

/** The only decrypt path. Its one caller is /api/chat, after the session check. */
export async function getDecryptedKey(userId: string): Promise<string> {
	const row = await queryOne<{ ciphertext: Buffer; iv: Buffer; tag: Buffer }>(
		'select ciphertext, iv, tag from provider_keys where user_id = $1',
		[userId]
	);
	if (!row) {
		throw new ApiError('no_key_configured', 'Connect your Anthropic key before sending a message.');
	}
	return openApiKey(
		{ ciphertext: row.ciphertext, iv: row.iv, authTag: row.tag, keyVersion: CURRENT_KEY_VERSION },
		userId,
		PROVIDER
	);
}

export async function deleteKey(userId: string): Promise<boolean> {
	return (await query('delete from provider_keys where user_id = $1 returning 1', [userId])).length > 0;
}
