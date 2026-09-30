import { PageHeading } from "../layout/PageHeading.jsx";
import { Link } from "../lib/router.jsx";

export function NotFound() {
  return (
    <div className="page">
      <PageHeading description="That page does not exist. It may have moved, or the link may be wrong.">Page not found</PageHeading>
      <p><Link to="/">Go to the home page</Link></p>
    </div>
  );
}
