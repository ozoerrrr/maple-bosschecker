import Link from "next/link";
import { requireProjectMember } from "@/lib/project";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { projectId: string };
}) {
  const { project, role } = await requireProjectMember(params.projectId);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <div>
          <Link href="/" className="text-muted text-xs hover:underline">
            ← 내 그룹
          </Link>
          <h1 className="text-xl font-bold">{project.name}</h1>
        </div>
        <nav className="flex gap-2 text-sm">
          <Link href={`/p/${project.id}`} className="btn-secondary">
            스케줄
          </Link>
          {role === "owner" && (
            <Link href={`/p/${project.id}/settings`} className="btn-secondary">
              그룹 관리
            </Link>
          )}
        </nav>
      </header>
      {children}
    </div>
  );
}
