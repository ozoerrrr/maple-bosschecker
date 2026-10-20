"use client";

// [추가] 카드 접기/펴기 상태 훅 (보스 목록·메소·다음주 공지 카드).
// 기본은 펼침이고, 접은 상태는 이 브라우저(localStorage)에 카드별로 기억한다 -- 보기 편의라 서버에 저장하지 않는다.
// 저장소를 쓸 수 없는 환경(사생활 보호 창 등)에서는 기억만 안 될 뿐 펼친 상태로 그대로 동작한다.
import { useCallback, useEffect, useState } from "react";

export function useCardOpen(key: string, defaultOpen = true): [boolean, () => void, (v: boolean) => void] {
  const storageKey = `card-open:${key}`;
  const [open, setOpenState] = useState(defaultOpen);

  // 처음 그린 뒤 저장된 값으로 맞춘다 (서버 렌더와 첫 화면이 같도록 useState 초기값에서 읽지 않음)
  useEffect(() => {
    try {
      const v = localStorage.getItem(storageKey);
      if (v === "0") setOpenState(false);
      else if (v === "1") setOpenState(true);
    } catch {
      // 저장소 사용 불가 -- 기본값 유지
    }
  }, [storageKey]);

  const save = useCallback(
    (v: boolean) => {
      try {
        localStorage.setItem(storageKey, v ? "1" : "0");
      } catch {
        // 저장 실패는 무시
      }
    },
    [storageKey]
  );

  const setOpen = useCallback(
    (v: boolean) => {
      setOpenState(v);
      save(v);
    },
    [save]
  );

  const toggle = useCallback(() => {
    setOpenState((prev) => {
      save(!prev);
      return !prev;
    });
  }, [save]);

  return [open, toggle, setOpen];
}
