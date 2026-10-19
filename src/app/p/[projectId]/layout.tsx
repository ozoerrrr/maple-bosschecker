import Link from "next/link";
import HelpToggle from "@/components/HelpToggle";
import LiveRefreshButton from "@/components/LiveRefreshButton";
import { requireProjectMember } from "@/lib/project";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { projectId: string };
}) {
  const { project, role, user } = await requireProjectMember(params.projectId);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <div>
          <Link href="/" className="text-muted text-xs hover:underline">
            ← 내 그룹
          </Link>
          <h1 className="text-xl font-bold flex items-center gap-2">
            {project.name}
            {/* [추가] 변경 알림(레드닷) + 새로고침 버튼 (스케줄 페이지에서만 보임) */}
            <LiveRefreshButton projectId={project.id} currentUserId={user.id} />
            <HelpToggle projectId={project.id} /> {/* [변경] 도움말 버튼을 그룹 이름 옆으로 (스케줄 페이지에서만 보임) */}
          </h1>
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
