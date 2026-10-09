import { CORS, preflight, readParams } from "@/lib/auth/http";
import { revokeToken } from "@/lib/auth/store";

// RFC 7009: always 200, even for unknown tokens. Revokes the token's whole family.
export async function POST(req: Request) {
  const token = (await readParams(req)).get("token");
  if (token) await revokeToken(token);
  return new Response(null, { status: 200, headers: CORS });
}

export const OPTIONS = preflight;
