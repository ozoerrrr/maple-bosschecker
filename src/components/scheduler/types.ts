export interface PartyCandidate {
  label: string;
  score: number;
}

export interface BossParty {
  id: string;
  name: string;
  diff: "Easy" | "Normal" | "Hard" | "Chaos" | "Extreme";
  diffClass: string;
  icon: string;
  members: string[];
  confirmedTime: string;
  cleared: boolean;
  candidates: PartyCandidate[];
}

export interface UserAvailabilityMap {
  [memberName: string]: string[]; // Array of "Day-Hour", e.g., "금-21"
}

export interface GroupMember {
  id: string;
  name: string;
  role?: "leader" | "member";
  avatarUrl?: string;
}
