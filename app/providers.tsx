'use client';

import {ReactNode, useMemo} from 'react';
import {ConvexProvider, ConvexReactClient} from 'convex/react';

export function Providers({children}: {children: ReactNode}) {
  const client = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    // The Convex deployment URL is wired up in a later phase; render children
    // without a live client until then so the app still builds and boots.
    return url ? new ConvexReactClient(url) : null;
  }, []);

  if (!client) {
    return <>{children}</>;
  }

  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}
