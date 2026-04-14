import { NextResponse } from 'next/server';
export async function GET() {
  return NextResponse.json({
    hasClientId: !!process.env.GOOGLE_CLIENT_ID,
    hasClientSecret: !!process.env.GOOGLE_CLIENT_SECRET,
    hasRefreshToken: !!process.env.GOOGLE_REFRESH_TOKEN,
    hasServiceAccount: !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
    hasGithubToken: !!process.env.GITHUB_TOKEN,
    vercel: process.env.VERCEL,
  });
}
