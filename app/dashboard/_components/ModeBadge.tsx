'use client';

import {useQuery} from 'convex/react';
import {api} from '@/convex/_generated/api';

/**
 * The effective AUTHZ_MODE, read from the server (the deployment's env). The
 * client only displays it — it cannot set it.
 */
export function ModeBadge() {
  const data = useQuery(api.dashboard.getAuthzMode);
  if (!data) return <span className="badge">mode…</span>;
  const broken = data.mode === 'broken';
  return (
    <div
      className={`mode-banner ${broken ? 'mode-broken' : 'mode-intersection'}`}
    >
      <span className={`badge ${broken ? 'bad' : 'ok'}`}>
        <span className="dot" />
        AUTHZ_MODE = {data.mode}
      </span>
      <span className="muted">
        {broken
          ? 'confused deputy active — agent identity alone; the acting human is never checked'
          : 'human ∩ agent enforced — the acting human’s ceiling applies via the component'}
      </span>
    </div>
  );
}
