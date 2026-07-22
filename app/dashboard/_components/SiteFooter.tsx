const REPO = 'https://github.com/kinde-starter-kits/contract-intelligence-demo';

/** Tasteful "powered by Kinde" framing — text only, no logo/trademark misuse.
 *  The Kinde mention links to kinde.com; the repo link points to the starter kit. */
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <span>
        A standalone community demo of agent authorization, with real sessions
        and real enforcement. <a href={REPO}>View the source</a>.
      </span>
      <a
        className="powered"
        href="https://kinde.com"
        target="_blank"
        rel="noreferrer"
      >
        <span className="spark" /> Powered by <span className="k">Kinde</span>{' '}
        agent auth
      </a>
    </footer>
  );
}
