// The page's single h1. It is focusable (tabIndex -1) so navigation can move focus here.
export function PageHeading({ children, description }) {
  return (
    <div className="page-heading">
      <h1 tabIndex={-1}>{children}</h1>
      {description ? <p className="lede">{description}</p> : null}
    </div>
  );
}
