"use client";

// [추가] 그룹 화면의 버튼(새로고침·도움말)을 사이트 상단 바 오른쪽 자리(#site-header-actions, app/layout.tsx)로 옮겨 그린다.
// 상단 바는 모든 페이지가 함께 쓰는 곳이라 그룹 정보를 모르기 때문에, 버튼은 그룹 화면에서 만들고 포털로 그 자리에 꽂는다.
// 그룹 화면을 벗어나면 이 컴포넌트가 사라지면서 버튼도 함께 빠진다.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export default function HeaderActions({ children }: { children: React.ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  // 화면이 그려진 뒤 상단 바의 빈 자리를 찾는다 (서버 렌더 때는 document가 없어서 아무것도 그리지 않음)
  useEffect(() => {
    setSlot(document.getElementById("site-header-actions"));
  }, []);

  return slot ? createPortal(children, slot) : null;
}
