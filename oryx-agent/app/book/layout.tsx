/** Avoid stale HTML for the preview form behind CDNs / ALB. */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Book an appointment | Smile Squad Pediatric Dentistry",
  description: "Schedule a pediatric dental visit online with Smile Squad.",
};

export default function BookLayout({ children }: { children: React.ReactNode }) {
  return <div className="ss-book-root">{children}</div>;
}
