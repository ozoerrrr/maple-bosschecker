// supabase/migrations/0001_init.sql 과 1:1 대응하는 손으로 쓴 타입.
// (스키마가 안정되면 `supabase gen types typescript`로 자동 생성본으로 교체 권장)
//
// @supabase/postgrest-js의 GenericTable은 Row/Insert/Update 외에
// Relationships 필드도 요구한다 (없으면 타입 추론이 전부 `never`로
// 무너진다) -- 조인 타입 추론에 쓰이는 필드라 여기서는 전부 빈 배열로 둔다.
type NoRelationships = { foreignKeyName: string; columns: string[]; isOneToOne?: boolean; referencedRelation: string; referencedColumns: string[] }[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string;
          avatar_url: string | null;
          nexon_character_name: string | null;
          nexon_world_name: string | null;
          nexon_linked_at: string | null;
          nexon_api_key_enc: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["profiles"]["Row"]> & { id: string };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Row"]>;
        Relationships: NoRelationships;
      };
      projects: {
        Row: {
          id: string;
          name: string;
          invite_code: string;
          owner_id: string;
          week_state_for: string | null;
          max_per_hour: number;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["projects"]["Row"]> & {
          name: string;
          owner_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["projects"]["Row"]>;
        Relationships: NoRelationships;
      };
      project_members: {
        Row: {
          project_id: string;
          user_id: string;
          role: "owner" | "member";
          color: string | null;
          joined_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["project_members"]["Row"]> & {
          project_id: string;
          user_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["project_members"]["Row"]>;
        Relationships: NoRelationships;
      };
      bosses: {
        Row: {
          id: string;
          project_id: string;
          name: string;
          period: "weekly" | "monthly";
          difficulty: "easy" | "normal" | "hard" | "chaos" | "extreme" | null;
          sort_order: number;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["bosses"]["Row"]> & {
          project_id: string;
          name: string;
        };
        Update: Partial<Database["public"]["Tables"]["bosses"]["Row"]>;
        Relationships: NoRelationships;
      };
      parties: {
        Row: {
          id: string;
          project_id: string;
          boss_id: string;
          label: string | null;
          sort_order: number;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["parties"]["Row"]> & {
          project_id: string;
          boss_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["parties"]["Row"]>;
        Relationships: NoRelationships;
      };
      party_members: {
        Row: { party_id: string; user_id: string; character_name: string | null };
        Insert: { party_id: string; user_id: string; character_name?: string | null };
        Update: Partial<{ party_id: string; user_id: string; character_name: string | null }>;
        Relationships: NoRelationships;
      };
      boss_candidates: {
        Row: {
          id: string;
          project_id: string;
          boss_id: string;
          user_id: string;
          character_name: string;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["boss_candidates"]["Row"]> & {
          project_id: string;
          boss_id: string;
          user_id: string;
          character_name: string;
        };
        Update: Partial<Database["public"]["Tables"]["boss_candidates"]["Row"]>;
        Relationships: NoRelationships;
      };
      availability: {
        Row: { project_id: string; user_id: string; day: string; hour: number };
        Insert: { project_id: string; user_id: string; day: string; hour: number };
        Update: Partial<Database["public"]["Tables"]["availability"]["Row"]>;
        Relationships: NoRelationships;
      };
      next_availability: {
        Row: { project_id: string; user_id: string; day: string; hour: number };
        Insert: { project_id: string; user_id: string; day: string; hour: number };
        Update: Partial<Database["public"]["Tables"]["next_availability"]["Row"]>;
        Relationships: NoRelationships;
      };
      monthly_block: {
        Row: { project_id: string; user_id: string; blocked_date: string };
        Insert: { project_id: string; user_id: string; blocked_date: string };
        Update: Partial<Database["public"]["Tables"]["monthly_block"]["Row"]>;
        Relationships: NoRelationships;
      };
      // [추가] 0011 캐릭터별 솔로 보스 계획
      solo_plans: {
        Row: {
          project_id: string;
          user_id: string;
          character_name: string;
          boss_name: string;
          difficulty: string;
          party_size: number;
          week: "this" | "next";
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["solo_plans"]["Row"], "updated_at" | "party_size" | "week"> & {
          party_size?: number;
          week?: "this" | "next";
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["solo_plans"]["Row"]>;
        Relationships: NoRelationships;
      };
      // [추가] 0011 솔로 보스 클리어 체크
      solo_clears: {
        Row: { project_id: string; user_id: string; character_name: string; boss_name: string; period_key: string };
        Insert: { project_id: string; user_id: string; character_name: string; boss_name: string; period_key: string };
        Update: Partial<Database["public"]["Tables"]["solo_clears"]["Row"]>;
        Relationships: NoRelationships;
      };
      // [추가] 0011 직접 추가한 캐릭터
      extra_characters: {
        Row: { project_id: string; user_id: string; character_name: string; created_at: string };
        Insert: { project_id: string; user_id: string; character_name: string; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["extra_characters"]["Row"]>;
        Relationships: NoRelationships;
      };
      party_confirmations: {
        Row: {
          party_id: string;
          day: string | null;
          hour: number | null;
          confirmed_date: string | null;
          cleared: boolean;
          confirmed_by: string | null;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["party_confirmations"]["Row"]> & {
          party_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["party_confirmations"]["Row"]>;
        Relationships: NoRelationships;
      };
      next_party_confirmations: {
        Row: {
          party_id: string;
          day: string | null;
          hour: number | null;
          confirmed_by: string | null;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["next_party_confirmations"]["Row"]> & {
          party_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["next_party_confirmations"]["Row"]>;
        Relationships: NoRelationships;
      };
    };
    Views: Record<string, never>;
    // [변경] supabase.rpc()로 부르는 DB 함수의 인자·반환 타입
    Functions: {
      debug_whoami: { Args: Record<string, never>; Returns: unknown };
      // [추가] 0010 주간 리셋 (이번주 처음 호출 때만 true)
      apply_weekly_reset: { Args: { p_project_id: string }; Returns: boolean };
      // [추가] 0010 월간보스 우선: 밀어낸 주간 확정 수
      push_out_weekly_for_monthly: { Args: { p_party_id: string }; Returns: number };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
