
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "event_invites": {
                  Row: {
                    "created_at": string,"event_id": string,"revoked_at": string | null,"token": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"event_id": string,"revoked_at"?: string | null,"token"?: string
                  }
                  Update: {
                    "created_at"?: string,"event_id"?: string,"revoked_at"?: string | null,"token"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "event_invites_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    }
                  ]
                },"events": {
                  Row: {
                    "cancelled_at": string | null,"cover_path": string | null,"created_at": string,"description": string | null,"ends_at": string | null,"guest_list_visible": boolean,"host_id": string,"id": string,"latitude": number | null,"location_point": unknown,"location_text": string,"longitude": number | null,"place_name": string | null,"starts_at": string,"theme": string,"time_changed_at": string | null,"time_zone": string,"title": string,"updated_at": string,"event_ended_at": string | null
                  }
                  ComputedFields: "event_ended_at"
                  Insert: {
                    "cancelled_at"?: string | null,"cover_path"?: string | null,"created_at"?: string,"description"?: string | null,"ends_at"?: string | null,"guest_list_visible"?: boolean,"host_id"?: string,"id"?: string,"latitude"?: number | null,"location_point"?: never,"location_text": string,"longitude"?: number | null,"place_name"?: string | null,"starts_at": string,"theme"?: string,"time_changed_at"?: string | null,"time_zone"?: string,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "cancelled_at"?: string | null,"cover_path"?: string | null,"created_at"?: string,"description"?: string | null,"ends_at"?: string | null,"guest_list_visible"?: boolean,"host_id"?: string,"id"?: string,"latitude"?: number | null,"location_point"?: never,"location_text"?: string,"longitude"?: number | null,"place_name"?: string | null,"starts_at"?: string,"theme"?: string,"time_changed_at"?: string | null,"time_zone"?: string,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "events_host_id_fkey"
      columns: ["host_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "avatar_path": string | null,"created_at": string,"display_name": string | null,"id": string,"locale": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "avatar_path"?: string | null,"created_at"?: string,"display_name"?: string | null,"id": string,"locale"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "avatar_path"?: string | null,"created_at"?: string,"display_name"?: string | null,"id"?: string,"locale"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"rsvp_rate_limits": {
                  Row: {
                    "bucket": string,"count": number,"window_start": string
                  }
                  ComputedFields: never
                  Insert: {
                    "bucket": string,"count"?: number,"window_start": string
                  }
                  Update: {
                    "bucket"?: string,"count"?: number,"window_start"?: string
                  }
                  Relationships: [
                    
                  ]
                },"rsvps": {
                  Row: {
                    "created_at": string,"display_name": string,"event_id": string,"guest_token_hash": string | null,"id": string,"status": Database["public"]['Enums']["rsvp_status"],"updated_at": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"display_name": string,"event_id": string,"guest_token_hash"?: string | null,"id"?: string,"status": Database["public"]['Enums']["rsvp_status"],"updated_at"?: string,"user_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"display_name"?: string,"event_id"?: string,"guest_token_hash"?: string | null,"id"?: string,"status"?: Database["public"]['Enums']["rsvp_status"],"updated_at"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "rsvps_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "rsvps_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "event_ended_at":
{ Args: { "e": Omit<Database["public"]['Tables']["events"]['Row'], Database["public"]['Tables']["events"]['ComputedFields']> }; Returns: string
                           },
"generate_invite_token":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"get_invite":
{ Args: { "p_guest_token"?: string,"p_token": string }; Returns: Json
                           },
"hash_guest_token":
{ Args: { "p_guest_token": string }; Returns: string
                           },
"hit_rate_limit":
{ Args: { "p_bucket": string,"p_max": number,"p_window_seconds": number }; Returns: boolean
                           },
"is_event_host":
{ Args: { "p_event_id": string }; Returns: boolean
                           },
"max_rsvps_per_event":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"open_event_for_token":
{ Args: { "p_token": string }; Returns: {
              "cancelled_at": string | null,
"cover_path": string | null,
"created_at": string,
"description": string | null,
"ends_at": string | null,
"guest_list_visible": boolean,
"host_id": string,
"id": string,
"latitude": number | null,
"location_point": unknown,
"location_text": string,
"longitude": number | null,
"place_name": string | null,
"starts_at": string,
"theme": string,
"time_changed_at": string | null,
"time_zone": string,
"title": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "events"
        isOneToOne: true
        isSetofReturn: false
      } },
"regenerate_invite":
{ Args: { "p_event_id": string }; Returns: string
                           },
"rsvp_as_user":
{ Args: { "p_status": Database["public"]['Enums']["rsvp_status"],"p_token": string }; Returns: Json
                           },
"run_retention":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"upsert_rsvp":
{ Args: { "p_display_name": string,"p_guest_token": string,"p_status": Database["public"]['Enums']["rsvp_status"],"p_token": string }; Returns: Json
                           },
"withdraw_rsvp":
{ Args: { "p_guest_token": string,"p_token": string }; Returns: boolean
                           }
          }
          Enums: {
            "rsvp_status": "going"|"maybe"|"declined"
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
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "rsvp_status": ["going", "maybe", "declined"]
          }
        }
} as const
