import { cookies } from 'next/headers';

export const OWNER_KEY_COOKIE = 'stayreviewr_owner';

export async function getReviewJobOwnerKey(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(OWNER_KEY_COOKIE)?.value ?? null;
}
