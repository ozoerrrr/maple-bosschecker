// 넥슨 오픈 API(https://openapi.nexon.com) 래퍼.
//
// 중요: 넥슨은 일반 소비자용 "넥슨 계정으로 로그인" OAuth를 제공하지 않는다.
// 대신 각 개발자가 개별적으로 발급받는 개인 API 키(x-nxopen-api-key 헤더)로
// 공개 게임 데이터(닉네임으로 캐릭터 조회 등)를 조회할 수 있을 뿐이다.
// 이 프로젝트에서는 그룹원 각자가 자기 개인 키를 프로필에 등록해두면,
// 그 키 + 자기 캐릭터 닉네임으로 "본인 확인 겸 캐릭터 정보 연동"을 하는
// 방식으로 쓴다 (실제 계정 소유권을 암호학적으로 증명하는 건 아니고, 친한
// 그룹 내에서 닉네임을 자동으로 채워주는 편의 기능에 가깝다).
//
// 엔드포인트 경로는 넥슨 오픈 API 문서가 바뀌면 같이 바뀔 수 있으니,
// 배포 전에 https://openapi.nexon.com/game/maplestory 최신 문서와
// 대조해서 확인할 것.
const NEXON_API_BASE = "https://open.api.nexon.com/maplestory/v1";

export interface NexonCharacterBasic {
  ouid: string;
  character_name: string;
  world_name: string;
  character_level: number;
  character_class: string;
}

export class NexonApiError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

async function nexonFetch(path: string, apiKey: string): Promise<unknown> {
  const res = await fetch(`${NEXON_API_BASE}${path}`, {
    headers: { "x-nxopen-api-key": apiKey },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new NexonApiError(`넥슨 API 호출 실패 (${res.status}): ${body.slice(0, 200)}`, res.status);
  }
  return res.json();
}

/** 캐릭터 닉네임 -> ocid (넥슨 내부 캐릭터 식별자). 공식 문서 필드명은 ocid지만,
 * 혹시 모를 구버전 응답(ouid)도 같이 받아둔다. */
export async function lookupOuid(characterName: string, apiKey: string): Promise<string> {
  const data = (await nexonFetch(`/id?character_name=${encodeURIComponent(characterName)}`, apiKey)) as {
    ocid?: string;
    ouid?: string;
  };
  const id = data.ocid ?? data.ouid;
  if (!id) throw new NexonApiError("해당 닉네임의 캐릭터를 찾을 수 없어요.");
  return id;
}

export interface NexonBossContent {
  content_name: string;
  difficulty: string;
  cycle: string;
  list_order_no: number;
  registration_flag: string; // "true" | "false"
  complete_flag: string; // "true" | "false"
}

interface NexonSchedulerCharacterState {
  date: string;
  character_name: string;
  world_name: string;
  character_level: number;
  character_class: string;
  boss_contents?: NexonBossContent[];
  weekly_boss_clear_count?: number;
  weekly_boss_clear_limit_count?: number;
}

/** 캐릭터가 인게임 "스케줄러"에 실제로 등록해둔 보스 목록(완료 여부 포함)을 가져온다.
 * registration_flag === "true" 인 것만 "이 캐릭터가 도는 보스"로 본다. */
export async function fetchRegisteredBossSchedule(
  ocid: string,
  apiKey: string
): Promise<{ registered: NexonBossContent[]; raw: NexonSchedulerCharacterState }> {
  const data = (await nexonFetch(
    `/scheduler/character-state?ocid=${encodeURIComponent(ocid)}`,
    apiKey
  )) as NexonSchedulerCharacterState;
  const registered = (data.boss_contents ?? []).filter((b) => b.registration_flag === "true");
  return { registered, raw: data };
}

/** ocid -> 캐릭터 기본 정보(월드, 레벨, 직업 등). (공식 문서 쿼리 파라미터명은 ocid) */
export async function fetchCharacterBasic(ouid: string, apiKey: string): Promise<NexonCharacterBasic> {
  const data = (await nexonFetch(`/character/basic?ocid=${encodeURIComponent(ouid)}`, apiKey)) as Record<
    string,
    unknown
  >;
  return {
    ouid,
    character_name: String(data.character_name ?? ""),
    world_name: String(data.world_name ?? ""),
    character_level: Number(data.character_level ?? 0),
    character_class: String(data.character_class ?? ""),
  };
}

/** 닉네임 + API 키만으로 바로 기본 정보까지 받아오는 헬퍼. */
export async function verifyAndFetchCharacter(characterName: string, apiKey: string): Promise<NexonCharacterBasic> {
  const ouid = await lookupOuid(characterName, apiKey);
  return fetchCharacterBasic(ouid, apiKey);
}
