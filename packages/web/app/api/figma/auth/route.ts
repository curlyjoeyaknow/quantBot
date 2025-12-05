import { NextRequest, NextResponse } from 'next/server';

/**
 * Figma OAuth Authorization Initiator
 * Redirects user to Figma's OAuth authorization page
 */
export async function GET(request: NextRequest) {
  const clientId = process.env.FIGMA_CLIENT_ID;
  
  if (!clientId) {
    return NextResponse.json(
      { error: 'Figma client ID not configured' },
      { status: 500 }
    );
  }

  // Generate a random state parameter for CSRF protection
  const state = Math.random().toString(36).substring(7);
  
  // Build the authorization URL
  const authUrl = new URL('https://www.figma.com/oauth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', `${new URL(request.url).origin}/api/figma/callback`);
  authUrl.searchParams.set('scope', 'file_read');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('response_type', 'code');

  return NextResponse.redirect(authUrl.toString());
}

