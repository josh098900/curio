
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "activities": {
                  Row: {
                    "approx_location": unknown,"area_label": string,"cancel_reason": string | null,"cancelled_at": string | null,"category": Database["public"]['Enums']["activity_category"],"created_at": string,"description": string | null,"ends_at": string,"host_id": string,"hostel_id": string | null,"id": string,"max_participants": number,"starts_at": string,"time_changed_at": string | null,"timezone": string,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "approx_location": unknown,"area_label": string,"cancel_reason"?: string | null,"cancelled_at"?: string | null,"category": Database["public"]['Enums']["activity_category"],"created_at"?: string,"description"?: string | null,"ends_at": string,"host_id": string,"hostel_id"?: string | null,"id"?: string,"max_participants": number,"starts_at": string,"time_changed_at"?: string | null,"timezone": string,"title": string
                  }
                  Update: {
                    "approx_location"?: unknown,"area_label"?: string,"cancel_reason"?: string | null,"cancelled_at"?: string | null,"category"?: Database["public"]['Enums']["activity_category"],"created_at"?: string,"description"?: string | null,"ends_at"?: string,"host_id"?: string,"hostel_id"?: string | null,"id"?: string,"max_participants"?: number,"starts_at"?: string,"time_changed_at"?: string | null,"timezone"?: string,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "activities_host_id_fkey"
      columns: ["host_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "activities_hostel_id_fkey"
      columns: ["hostel_id"]
isOneToOne: false
      referencedRelation: "hostels"
      referencedColumns: ["id"]
    }
                  ]
                },"activity_locations": {
                  Row: {
                    "activity_id": string,"location": unknown,"meeting_note": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "activity_id": string,"location": unknown,"meeting_note"?: string | null
                  }
                  Update: {
                    "activity_id"?: string,"location"?: unknown,"meeting_note"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "activity_locations_activity_id_fkey"
      columns: ["activity_id"]
isOneToOne: true
      referencedRelation: "activities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "activity_locations_activity_id_fkey"
      columns: ["activity_id"]
isOneToOne: true
      referencedRelation: "activity_status"
      referencedColumns: ["activity_id"]
    }
                  ]
                },"activity_participants": {
                  Row: {
                    "activity_id": string,"joined_at": string,"status": string,"updated_at": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "activity_id": string,"joined_at"?: string,"status": string,"updated_at"?: string | null,"user_id": string
                  }
                  Update: {
                    "activity_id"?: string,"joined_at"?: string,"status"?: string,"updated_at"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "activity_participants_activity_id_fkey"
      columns: ["activity_id"]
isOneToOne: false
      referencedRelation: "activities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "activity_participants_activity_id_fkey"
      columns: ["activity_id"]
isOneToOne: false
      referencedRelation: "activity_status"
      referencedColumns: ["activity_id"]
    },{
      foreignKeyName: "activity_participants_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"audit_log": {
                  Row: {
                    "action": string,"actor_id": string,"created_at": string,"details": Json | null,"id": string,"reason": string | null,"subject_id": string | null,"target_id": string,"target_type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id": string,"created_at"?: string,"details"?: Json | null,"id"?: string,"reason"?: string | null,"subject_id"?: string | null,"target_id": string,"target_type": string
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string,"created_at"?: string,"details"?: Json | null,"id"?: string,"reason"?: string | null,"subject_id"?: string | null,"target_id"?: string,"target_type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_log_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "audit_log_subject_id_fkey"
      columns: ["subject_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"blocks": {
                  Row: {
                    "blocked_id": string,"blocker_id": string,"created_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "blocked_id": string,"blocker_id": string,"created_at"?: string
                  }
                  Update: {
                    "blocked_id"?: string,"blocker_id"?: string,"created_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "blocks_blocked_id_fkey"
      columns: ["blocked_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "blocks_blocker_id_fkey"
      columns: ["blocker_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"hostel_staff": {
                  Row: {
                    "hostel_id": string,"staff_role": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "hostel_id": string,"staff_role": string,"user_id": string
                  }
                  Update: {
                    "hostel_id"?: string,"staff_role"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "hostel_staff_hostel_id_fkey"
      columns: ["hostel_id"]
isOneToOne: false
      referencedRelation: "hostels"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "hostel_staff_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"hostels": {
                  Row: {
                    "address": string,"applicant_role": string,"applied_by": string | null,"city": string,"contact_email": string,"contact_phone": string | null,"country": string,"created_at": string,"id": string,"location": unknown,"name": string,"reviewed_at": string | null,"status": string,"timezone": string,"website": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "address": string,"applicant_role": string,"applied_by"?: string | null,"city": string,"contact_email": string,"contact_phone"?: string | null,"country": string,"created_at"?: string,"id"?: string,"location": unknown,"name": string,"reviewed_at"?: string | null,"status"?: string,"timezone": string,"website"?: string | null
                  }
                  Update: {
                    "address"?: string,"applicant_role"?: string,"applied_by"?: string | null,"city"?: string,"contact_email"?: string,"contact_phone"?: string | null,"country"?: string,"created_at"?: string,"id"?: string,"location"?: unknown,"name"?: string,"reviewed_at"?: string | null,"status"?: string,"timezone"?: string,"website"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "hostels_applied_by_fkey"
      columns: ["applied_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"messages": {
                  Row: {
                    "activity_id": string,"body": string,"created_at": string,"id": string,"removed_at": string | null,"sender_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "activity_id": string,"body": string,"created_at"?: string,"id"?: string,"removed_at"?: string | null,"sender_id"?: string | null
                  }
                  Update: {
                    "activity_id"?: string,"body"?: string,"created_at"?: string,"id"?: string,"removed_at"?: string | null,"sender_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "messages_activity_id_fkey"
      columns: ["activity_id"]
isOneToOne: false
      referencedRelation: "activities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "messages_activity_id_fkey"
      columns: ["activity_id"]
isOneToOne: false
      referencedRelation: "activity_status"
      referencedColumns: ["activity_id"]
    },{
      foreignKeyName: "messages_sender_id_fkey"
      columns: ["sender_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"moderation_appeals": {
                  Row: {
                    "audit_log_id": string,"created_at": string,"id": string,"reason": string,"resolved_at": string | null,"status": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "audit_log_id": string,"created_at"?: string,"id"?: string,"reason": string,"resolved_at"?: string | null,"status"?: string,"user_id": string
                  }
                  Update: {
                    "audit_log_id"?: string,"created_at"?: string,"id"?: string,"reason"?: string,"resolved_at"?: string | null,"status"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "moderation_appeals_audit_log_id_fkey"
      columns: ["audit_log_id"]
isOneToOne: false
      referencedRelation: "audit_log"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "moderation_appeals_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"notifications": {
                  Row: {
                    "created_at": string,"dedupe_key": string,"id": string,"payload": NonNullable<Json>,"read_at": string | null,"type": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"dedupe_key": string,"id"?: string,"payload": NonNullable<Json>,"read_at"?: string | null,"type": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"dedupe_key"?: string,"id"?: string,"payload"?: NonNullable<Json>,"read_at"?: string | null,"type"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notifications_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "account_status": string,"age_band": string | null,"avatar_path": string | null,"bio": string | null,"created_at": string,"display_name": string | null,"home_country": string | null,"id": string,"is_over_18": boolean,"languages": (string)[],"over_18_declared_at": string | null,"role": string,"terms_accepted_at": string | null,"terms_version": string | null,"verification_status": string,"verified_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "account_status"?: string,"age_band"?: string | null,"avatar_path"?: string | null,"bio"?: string | null,"created_at"?: string,"display_name"?: string | null,"home_country"?: string | null,"id": string,"is_over_18"?: boolean,"languages"?: (string)[],"over_18_declared_at"?: string | null,"role"?: string,"terms_accepted_at"?: string | null,"terms_version"?: string | null,"verification_status"?: string,"verified_at"?: string | null
                  }
                  Update: {
                    "account_status"?: string,"age_band"?: string | null,"avatar_path"?: string | null,"bio"?: string | null,"created_at"?: string,"display_name"?: string | null,"home_country"?: string | null,"id"?: string,"is_over_18"?: boolean,"languages"?: (string)[],"over_18_declared_at"?: string | null,"role"?: string,"terms_accepted_at"?: string | null,"terms_version"?: string | null,"verification_status"?: string,"verified_at"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"reports": {
                  Row: {
                    "created_at": string,"details": string | null,"id": string,"reason": string,"reporter_id": string | null,"resolved_at": string | null,"status": string,"target_id": string,"target_type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"details"?: string | null,"id"?: string,"reason": string,"reporter_id"?: string | null,"resolved_at"?: string | null,"status"?: string,"target_id": string,"target_type": string
                  }
                  Update: {
                    "created_at"?: string,"details"?: string | null,"id"?: string,"reason"?: string,"reporter_id"?: string | null,"resolved_at"?: string | null,"status"?: string,"target_id"?: string,"target_type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "reports_reporter_id_fkey"
      columns: ["reporter_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"stays": {
                  Row: {
                    "check_in": string,"check_out": string,"hostel_id": string,"id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "check_in": string,"check_out": string,"hostel_id": string,"id"?: string,"user_id": string
                  }
                  Update: {
                    "check_in"?: string,"check_out"?: string,"hostel_id"?: string,"id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "stays_hostel_id_fkey"
      columns: ["hostel_id"]
isOneToOne: false
      referencedRelation: "hostels"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stays_user_id_fkey"
      columns: ["user_id"]
isOneToOne: true
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"verification_sessions": {
                  Row: {
                    "created_at": string,"id": string,"last_error_code": string | null,"provider": string,"provider_session_id": string,"status": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"last_error_code"?: string | null,"provider": string,"provider_session_id": string,"status": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"last_error_code"?: string | null,"provider"?: string,"provider_session_id"?: string,"status"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "verification_sessions_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            "activity_status": {
                  Row: {
                    "activity_id": string,"joined_count": number | null,"status": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                }
          }
          Functions: {
            "health":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           }
          }
          Enums: {
            "activity_category": "going_out"|"food"|"day_trips"|"outdoors"|"chilled"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "activity_category": ["going_out", "food", "day_trips", "outdoors", "chilled"]
          }
        }
} as const
