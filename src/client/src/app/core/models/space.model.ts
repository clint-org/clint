export interface Space {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface SpaceMember {
  id: string;
  space_id: string;
  user_id: string;
  role: 'owner' | 'editor' | 'viewer';
  created_at: string;
  email?: string;
  display_name?: string;
}

export interface SpaceInvite {
  id: string;
  space_id: string;
  email: string;
  role: 'owner' | 'editor' | 'viewer';
  invite_code: string;
  created_by: string | null;
  accepted_at: string | null;
  accepted_by: string | null;
  expires_at: string;
  created_at: string;
}
