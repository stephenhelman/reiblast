import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getToken } from 'next-auth/jwt'

export async function middleware(request: NextRequest) {
  const hostname = request.headers.get('host') || ''
  const { pathname } = request.nextUrl

  const isToolsHost =
    hostname.startsWith('tools.') ||
    hostname === 'tools.reiblast.app' ||
    hostname === 'localhost:3001'

  if (isToolsHost) {
    // Widget routes skip auth entirely
    if (pathname.startsWith('/widget')) {
      return NextResponse.rewrite(
        new URL(`/tools/widget${pathname.replace('/widget', '')}`, request.url)
      )
    }

    // Check session for all other tools routes
    const token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET,
    })

    if (!token) {
      const loginUrl = new URL('https://reiblast.app/login')
      loginUrl.searchParams.set('callbackUrl', request.url)
      return NextResponse.redirect(loginUrl)
    }

    return NextResponse.rewrite(
      new URL(`/tools${pathname === '/' ? '' : pathname}`, request.url)
    )
  }

  // Marketing site — all other hostnames
  return NextResponse.rewrite(
    new URL(`/marketing${pathname === '/' ? '' : pathname}`, request.url)
  )
}

export const config = {
  matcher: [
    /*
     * Match all paths EXCEPT:
     * - Files with a static extension (png, jpg, svg, ico, webp, etc.)
     * - Next.js internals (_next/static, _next/image)
     * - API routes
     */
    '/((?!api|_next/static|_next/image|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf|otf|mp4|pdf)$).*)',
  ],
}
