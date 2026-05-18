import { requireOrganizer } from "@/lib/auth/rbac";
import OrganizerNav from "@/components/organizer/OrganizerNav";

export default async function OrganizerLayout({ children }: { children: React.ReactNode }) {
  const session = await requireOrganizer();

  return (
    <div className="min-h-screen bg-gray-50">
      <OrganizerNav userName={session.user.name} />
      <div className="max-w-7xl mx-auto px-4 py-8">{children}</div>
    </div>
  );
}
