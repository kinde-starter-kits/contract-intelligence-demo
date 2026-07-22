/** Tasteful "powered by Kinde" framing — text only, no logo/trademark misuse. */
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <span>
        A standalone demo of agent authorization, with real sessions and real
        enforcement.
      </span>
      <span className="powered">
        <span className="spark" /> Powered by <span className="k">Kinde</span>{' '}
        agent auth
      </span>
    </footer>
  );
}
