import Link from "next/link";
import HelpToggle from "@/components/HelpToggle";
import HeaderActions from "@/components/HeaderActions"; // [추가]
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
          </h1>
          {/* [변경] 변경 알림(레드닷)·새로고침, 도움말 버튼을 사이트 상단 바 오른쪽으로 (스케줄 페이지에서만 보임) */}
          <HeaderActions>
            <LiveRefreshButton projectId={project.id} currentUserId={user.id} />
            <HelpToggle projectId={project.id} />
          </HeaderActions>
        </div>
        <nav className="flex gap-2 text-sm">
          <Link href={`/p/${project.id}`} className="btn-secondary">
            스케줄
          </Link>
          {/* [변경] 0018: 부운영자도 그룹 관리(보스 목록)에 들어갈 수 있다 */}
          {(role === "owner" || role === "manager") && (
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
