import { NextRequest, NextResponse } from 'next/server';

/**
 * Figma OAuth Callback Handler
 * Handles the OAuth redirect from Figma after user authorization
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  // Handle authorization errors
  if (error) {
    console.error('Figma OAuth error:', error);
    return NextResponse.redirect(
      new URL(`/figma-replicas?error=${encodeURIComponent(error)}`, request.url)
    );
  }

  // Validate authorization code
  if (!code) {
    return NextResponse.redirect(
      new URL('/figma-replicas?error=no_code', request.url)
    );
  }

  try {
    // Exchange authorization code for access token
    const tokenResponse = await fetch('https://www.figma.com/api/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: process.env.FIGMA_CLIENT_ID || '',
        client_secret: process.env.FIGMA_CLIENT_SECRET || '',
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: `${new URL(request.url).origin}/api/figma/callback`,
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      console.error('Token exchange failed:', errorData);
      throw new Error('Failed to exchange code for token');
    }

    const tokenData = await tokenResponse.json();
    
    // Store the access token (you might want to use a more secure method)
    // For now, we'll redirect with the token in the URL
    const redirectUrl = new URL('/figma-replicas', request.url);
    redirectUrl.searchParams.set('figma_token', tokenData.access_token);
    redirectUrl.searchParams.set('figma_user_id', tokenData.user_id || '');
    redirectUrl.searchParams.set('success', 'true');

    return NextResponse.redirect(redirectUrl);

  } catch (error) {
    console.error('OAuth callback error:', error);
    return NextResponse.redirect(
      new URL('/figma-replicas?error=token_exchange_failed', request.url)
    );
  }
}

