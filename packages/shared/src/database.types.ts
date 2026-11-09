
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
            "co_host_invites": {
                  Row: {
                    "accepted_at": string | null,"accepted_by": string | null,"created_at": string,"event_id": string,"expires_at": string,"revoked_at": string | null,"token": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_at"?: string | null,"accepted_by"?: string | null,"created_at"?: string,"event_id": string,"expires_at"?: string,"revoked_at"?: string | null,"token"?: string
                  }
                  Update: {
                    "accepted_at"?: string | null,"accepted_by"?: string | null,"created_at"?: string,"event_id"?: string,"expires_at"?: string,"revoked_at"?: string | null,"token"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "co_host_invites_accepted_by_fkey"
      columns: ["accepted_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "co_host_invites_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    }
                  ]
                },"date_poll_options": {
                  Row: {
                    "created_at": string,"ends_at": string | null,"event_id": string,"final_if_needed": number | null,"final_no": number | null,"final_yes": number | null,"id": string,"starts_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"ends_at"?: string | null,"event_id": string,"final_if_needed"?: number | null,"final_no"?: number | null,"final_yes"?: number | null,"id"?: string,"starts_at": string
                  }
                  Update: {
                    "created_at"?: string,"ends_at"?: string | null,"event_id"?: string,"final_if_needed"?: number | null,"final_no"?: number | null,"final_yes"?: number | null,"id"?: string,"starts_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "date_poll_options_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    }
                  ]
                },"date_poll_voters": {
                  Row: {
                    "created_at": string,"display_name": string,"event_id": string,"guest_token_hash": string | null,"id": string,"updated_at": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"display_name": string,"event_id": string,"guest_token_hash"?: string | null,"id"?: string,"updated_at"?: string,"user_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"display_name"?: string,"event_id"?: string,"guest_token_hash"?: string | null,"id"?: string,"updated_at"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "date_poll_voters_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "date_poll_voters_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"date_poll_votes": {
                  Row: {
                    "choice": Database["public"]['Enums']["vote_choice"],"option_id": string,"voter_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "choice": Database["public"]['Enums']["vote_choice"],"option_id": string,"voter_id": string
                  }
                  Update: {
                    "choice"?: Database["public"]['Enums']["vote_choice"],"option_id"?: string,"voter_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "date_poll_votes_option_id_fkey"
      columns: ["option_id"]
isOneToOne: false
      referencedRelation: "date_poll_options"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "date_poll_votes_voter_id_fkey"
      columns: ["voter_id"]
isOneToOne: false
      referencedRelation: "date_poll_voters"
      referencedColumns: ["id"]
    }
                  ]
                },"event_announcements": {
                  Row: {
                    "author_id": string | null,"body": string | null,"created_at": string,"deleted_at": string | null,"event_id": string,"id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "author_id"?: string | null,"body"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"event_id": string,"id"?: string
                  }
                  Update: {
                    "author_id"?: string | null,"body"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"event_id"?: string,"id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "event_announcements_author_id_fkey"
      columns: ["author_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "event_announcements_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    }
                  ]
                },"event_co_hosts": {
                  Row: {
                    "added_at": string,"event_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "added_at"?: string,"event_id": string,"user_id": string
                  }
                  Update: {
                    "added_at"?: string,"event_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "event_co_hosts_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "event_co_hosts_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"event_invites": {
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
                },"event_series": {
                  Row: {
                    "allow_plus_ones": boolean,"anchor_index": number,"anchor_local_date": string,"capacity": number | null,"cover_path": string | null,"created_at": string,"created_by": string | null,"description": string | null,"duration": string | null,"ended_at": string | null,"ends_on": string | null,"frequency": string,"group_id": string,"guest_list_visible": boolean,"id": string,"latitude": number | null,"local_start_time": string,"location_text": string,"longitude": number | null,"max_plus_ones": number,"next_index": number,"place_name": string | null,"theme": string,"time_zone": string,"title": string,"updated_at": string,"wall_enabled": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "allow_plus_ones"?: boolean,"anchor_index"?: number,"anchor_local_date": string,"capacity"?: number | null,"cover_path"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"duration"?: string | null,"ended_at"?: string | null,"ends_on"?: string | null,"frequency": string,"group_id": string,"guest_list_visible"?: boolean,"id"?: string,"latitude"?: number | null,"local_start_time": string,"location_text": string,"longitude"?: number | null,"max_plus_ones"?: number,"next_index"?: number,"place_name"?: string | null,"theme"?: string,"time_zone"?: string,"title": string,"updated_at"?: string,"wall_enabled"?: boolean
                  }
                  Update: {
                    "allow_plus_ones"?: boolean,"anchor_index"?: number,"anchor_local_date"?: string,"capacity"?: number | null,"cover_path"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"duration"?: string | null,"ended_at"?: string | null,"ends_on"?: string | null,"frequency"?: string,"group_id"?: string,"guest_list_visible"?: boolean,"id"?: string,"latitude"?: number | null,"local_start_time"?: string,"location_text"?: string,"longitude"?: number | null,"max_plus_ones"?: number,"next_index"?: number,"place_name"?: string | null,"theme"?: string,"time_zone"?: string,"title"?: string,"updated_at"?: string,"wall_enabled"?: boolean
                  }
                  Relationships: [
                    {
      foreignKeyName: "event_series_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "event_series_group_id_fkey"
      columns: ["group_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["id"]
    }
                  ]
                },"events": {
                  Row: {
                    "allow_plus_ones": boolean,"cancelled_at": string | null,"capacity": number | null,"cover_path": string | null,"created_at": string,"date_picked_at": string | null,"description": string | null,"ends_at": string | null,"group_id": string | null,"guest_list_visible": boolean,"host_id": string,"id": string,"latitude": number | null,"location_point": unknown,"location_text": string,"longitude": number | null,"max_plus_ones": number,"occurrence_index": number | null,"place_name": string | null,"poll_closes_at": string | null,"series_id": string | null,"starts_at": string | null,"theme": string,"time_changed_at": string | null,"time_zone": string,"title": string,"updated_at": string,"wall_enabled": boolean,"event_ended_at": string | null
                  }
                  ComputedFields: "event_ended_at"
                  Insert: {
                    "allow_plus_ones"?: boolean,"cancelled_at"?: string | null,"capacity"?: number | null,"cover_path"?: string | null,"created_at"?: string,"date_picked_at"?: string | null,"description"?: string | null,"ends_at"?: string | null,"group_id"?: string | null,"guest_list_visible"?: boolean,"host_id"?: string,"id"?: string,"latitude"?: number | null,"location_point"?: never,"location_text": string,"longitude"?: number | null,"max_plus_ones"?: number,"occurrence_index"?: number | null,"place_name"?: string | null,"poll_closes_at"?: string | null,"series_id"?: string | null,"starts_at"?: string | null,"theme"?: string,"time_changed_at"?: string | null,"time_zone"?: string,"title": string,"updated_at"?: string,"wall_enabled"?: boolean
                  }
                  Update: {
                    "allow_plus_ones"?: boolean,"cancelled_at"?: string | null,"capacity"?: number | null,"cover_path"?: string | null,"created_at"?: string,"date_picked_at"?: string | null,"description"?: string | null,"ends_at"?: string | null,"group_id"?: string | null,"guest_list_visible"?: boolean,"host_id"?: string,"id"?: string,"latitude"?: number | null,"location_point"?: never,"location_text"?: string,"longitude"?: number | null,"max_plus_ones"?: number,"occurrence_index"?: number | null,"place_name"?: string | null,"poll_closes_at"?: string | null,"series_id"?: string | null,"starts_at"?: string | null,"theme"?: string,"time_changed_at"?: string | null,"time_zone"?: string,"title"?: string,"updated_at"?: string,"wall_enabled"?: boolean
                  }
                  Relationships: [
                    {
      foreignKeyName: "events_group_id_fkey"
      columns: ["group_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "events_host_id_fkey"
      columns: ["host_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "events_series_id_fkey"
      columns: ["series_id"]
isOneToOne: false
      referencedRelation: "event_series"
      referencedColumns: ["id"]
    }
                  ]
                },"group_invitations": {
                  Row: {
                    "created_at": string,"declined_at": string | null,"expires_at": string,"group_id": string,"invited_by": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"declined_at"?: string | null,"expires_at"?: string,"group_id": string,"invited_by"?: string | null,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"declined_at"?: string | null,"expires_at"?: string,"group_id"?: string,"invited_by"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "group_invitations_group_id_fkey"
      columns: ["group_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "group_invitations_invited_by_fkey"
      columns: ["invited_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "group_invitations_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"group_invite_links": {
                  Row: {
                    "created_at": string,"created_by": string | null,"group_id": string,"revoked_at": string | null,"token": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"group_id": string,"revoked_at"?: string | null,"token"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"group_id"?: string,"revoked_at"?: string | null,"token"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "group_invite_links_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "group_invite_links_group_id_fkey"
      columns: ["group_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["id"]
    }
                  ]
                },"group_members": {
                  Row: {
                    "group_id": string,"is_admin": boolean,"joined_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "group_id": string,"is_admin"?: boolean,"joined_at"?: string,"user_id": string
                  }
                  Update: {
                    "group_id"?: string,"is_admin"?: boolean,"joined_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "group_members_group_id_fkey"
      columns: ["group_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "group_members_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"groups": {
                  Row: {
                    "created_at": string,"id": string,"name": string,"owner_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"name": string,"owner_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string,"owner_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "groups_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"notification_deliveries": {
                  Row: {
                    "attempts": number,"channel": string,"created_at": string,"id": string,"last_error": string | null,"locked_until": string | null,"next_attempt_at": string,"notification_id": string,"provider_message_id": string | null,"push_token_id": string | null,"receipt_checked_at": string | null,"rsvp_id": string | null,"sent_at": string | null,"status": string,"urgent": boolean,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"channel": string,"created_at"?: string,"id"?: string,"last_error"?: string | null,"locked_until"?: string | null,"next_attempt_at"?: string,"notification_id": string,"provider_message_id"?: string | null,"push_token_id"?: string | null,"receipt_checked_at"?: string | null,"rsvp_id"?: string | null,"sent_at"?: string | null,"status"?: string,"urgent"?: boolean,"user_id"?: string | null
                  }
                  Update: {
                    "attempts"?: number,"channel"?: string,"created_at"?: string,"id"?: string,"last_error"?: string | null,"locked_until"?: string | null,"next_attempt_at"?: string,"notification_id"?: string,"provider_message_id"?: string | null,"push_token_id"?: string | null,"receipt_checked_at"?: string | null,"rsvp_id"?: string | null,"sent_at"?: string | null,"status"?: string,"urgent"?: boolean,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "notification_deliveries_notification_id_fkey"
      columns: ["notification_id"]
isOneToOne: false
      referencedRelation: "notifications"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notification_deliveries_push_token_fk"
      columns: ["push_token_id"]
isOneToOne: false
      referencedRelation: "push_tokens"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notification_deliveries_rsvp_id_fkey"
      columns: ["rsvp_id"]
isOneToOne: false
      referencedRelation: "rsvps"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notification_deliveries_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"notification_kinds": {
                  Row: {
                    "channels": (string)[],"kind": string,"stale_after_start": boolean,"urgent": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "channels": (string)[],"kind": string,"stale_after_start"?: boolean,"urgent"?: boolean
                  }
                  Update: {
                    "channels"?: (string)[],"kind"?: string,"stale_after_start"?: boolean,"urgent"?: boolean
                  }
                  Relationships: [
                    
                  ]
                },"notifications": {
                  Row: {
                    "audience": string,"coalesce_key": string | null,"created_at": string,"dedupe_key": string | null,"event_id": string | null,"exclude_user_id": string | null,"id": string,"kind": string,"not_before": string,"payload": NonNullable<Json>,"processed_at": string | null,"state": string,"subject_id": string | null,"target_rsvp_id": string | null,"target_user_id": string | null,"notification_recipients": {
              "channel": string,"push_token_id": string,"rsvp_id": string,"user_id": string
            } | null
                  }
                  ComputedFields: "notification_recipients"
                  Insert: {
                    "audience": string,"coalesce_key"?: string | null,"created_at"?: string,"dedupe_key"?: string | null,"event_id"?: string | null,"exclude_user_id"?: string | null,"id"?: string,"kind": string,"not_before"?: string,"payload"?: NonNullable<Json>,"processed_at"?: string | null,"state"?: string,"subject_id"?: string | null,"target_rsvp_id"?: string | null,"target_user_id"?: string | null
                  }
                  Update: {
                    "audience"?: string,"coalesce_key"?: string | null,"created_at"?: string,"dedupe_key"?: string | null,"event_id"?: string | null,"exclude_user_id"?: string | null,"id"?: string,"kind"?: string,"not_before"?: string,"payload"?: NonNullable<Json>,"processed_at"?: string | null,"state"?: string,"subject_id"?: string | null,"target_rsvp_id"?: string | null,"target_user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "notifications_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notifications_kind_fkey"
      columns: ["kind"]
isOneToOne: false
      referencedRelation: "notification_kinds"
      referencedColumns: ["kind"]
    },{
      foreignKeyName: "notifications_target_rsvp_id_fkey"
      columns: ["target_rsvp_id"]
isOneToOne: false
      referencedRelation: "rsvps"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notifications_target_user_id_fkey"
      columns: ["target_user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "avatar_path": string | null,"created_at": string,"display_name": string | null,"id": string,"locale": string | null,"updated_at": string,"wall_default_enabled": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "avatar_path"?: string | null,"created_at"?: string,"display_name"?: string | null,"id": string,"locale"?: string | null,"updated_at"?: string,"wall_default_enabled"?: boolean
                  }
                  Update: {
                    "avatar_path"?: string | null,"created_at"?: string,"display_name"?: string | null,"id"?: string,"locale"?: string | null,"updated_at"?: string,"wall_default_enabled"?: boolean
                  }
                  Relationships: [
                    
                  ]
                },"push_tokens": {
                  Row: {
                    "created_at": string,"id": string,"last_seen_at": string,"locale": string,"platform": string,"token": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"last_seen_at"?: string,"locale"?: string,"platform": string,"token": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"last_seen_at"?: string,"locale"?: string,"platform"?: string,"token"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "push_tokens_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"rsvp_claim_tickets": {
                  Row: {
                    "created_at": string,"expires_at": string,"guest_token_hash": string,"ticket_hash": string,"used_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"expires_at"?: string,"guest_token_hash": string,"ticket_hash": string,"used_at"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"expires_at"?: string,"guest_token_hash"?: string,"ticket_hash"?: string,"used_at"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"rsvp_email_subscriptions": {
                  Row: {
                    "consent_at": string,"consent_version": string,"created_at": string,"email": string,"event_id": string,"locale": string,"rsvp_id": string,"unsubscribe_token": string
                  }
                  ComputedFields: never
                  Insert: {
                    "consent_at": string,"consent_version": string,"created_at"?: string,"email": string,"event_id": string,"locale"?: string,"rsvp_id": string,"unsubscribe_token"?: string
                  }
                  Update: {
                    "consent_at"?: string,"consent_version"?: string,"created_at"?: string,"email"?: string,"event_id"?: string,"locale"?: string,"rsvp_id"?: string,"unsubscribe_token"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "rsvp_email_subscriptions_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "rsvp_email_subscriptions_rsvp_id_fkey"
      columns: ["rsvp_id"]
isOneToOne: true
      referencedRelation: "rsvps"
      referencedColumns: ["id"]
    }
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
                    "created_at": string,"display_name": string,"event_id": string,"guest_token_hash": string | null,"id": string,"plus_ones": number,"promoted_at": string | null,"status": Database["public"]['Enums']["rsvp_status"],"updated_at": string,"user_id": string | null,"waitlisted_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"display_name": string,"event_id": string,"guest_token_hash"?: string | null,"id"?: string,"plus_ones"?: number,"promoted_at"?: string | null,"status": Database["public"]['Enums']["rsvp_status"],"updated_at"?: string,"user_id"?: string | null,"waitlisted_at"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"display_name"?: string,"event_id"?: string,"guest_token_hash"?: string | null,"id"?: string,"plus_ones"?: number,"promoted_at"?: string | null,"status"?: Database["public"]['Enums']["rsvp_status"],"updated_at"?: string,"user_id"?: string | null,"waitlisted_at"?: string | null
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
                },"storage_deletion_queue": {
                  Row: {
                    "attempts": number,"bucket": string,"enqueued_at": string,"id": number,"last_error": string | null,"next_attempt_at": string,"path": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"bucket": string,"enqueued_at"?: string,"id"?: never,"last_error"?: string | null,"next_attempt_at"?: string,"path": string
                  }
                  Update: {
                    "attempts"?: number,"bucket"?: string,"enqueued_at"?: string,"id"?: never,"last_error"?: string | null,"next_attempt_at"?: string,"path"?: string
                  }
                  Relationships: [
                    
                  ]
                },"wall_blocks": {
                  Row: {
                    "created_at": string,"display_name": string,"event_id": string,"guest_hash": string | null,"id": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"display_name": string,"event_id": string,"guest_hash"?: string | null,"id"?: string,"user_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"display_name"?: string,"event_id"?: string,"guest_hash"?: string | null,"id"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "wall_blocks_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "wall_blocks_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"wall_photos": {
                  Row: {
                    "author_guest_hash": string | null,"author_user_id": string | null,"created_at": string,"event_id": string,"full_path": string,"height": number,"id": string,"is_host": boolean,"position": number,"post_id": string,"thumb_path": string,"width": number
                  }
                  ComputedFields: never
                  Insert: {
                    "author_guest_hash"?: string | null,"author_user_id"?: string | null,"created_at"?: string,"event_id": string,"full_path": string,"height": number,"id"?: string,"is_host"?: boolean,"position": number,"post_id": string,"thumb_path": string,"width": number
                  }
                  Update: {
                    "author_guest_hash"?: string | null,"author_user_id"?: string | null,"created_at"?: string,"event_id"?: string,"full_path"?: string,"height"?: number,"id"?: string,"is_host"?: boolean,"position"?: number,"post_id"?: string,"thumb_path"?: string,"width"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "wall_photos_author_user_id_fkey"
      columns: ["author_user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "wall_photos_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "wall_photos_post_id_fkey"
      columns: ["post_id"]
isOneToOne: false
      referencedRelation: "wall_posts"
      referencedColumns: ["id"]
    }
                  ]
                },"wall_posts": {
                  Row: {
                    "author_display_name": string,"author_guest_hash": string | null,"author_user_id": string | null,"body": string | null,"created_at": string,"event_id": string,"id": string,"is_host": boolean,"photo_count": number
                  }
                  ComputedFields: never
                  Insert: {
                    "author_display_name": string,"author_guest_hash"?: string | null,"author_user_id"?: string | null,"body"?: string | null,"created_at"?: string,"event_id": string,"id"?: string,"is_host"?: boolean,"photo_count"?: number
                  }
                  Update: {
                    "author_display_name"?: string,"author_guest_hash"?: string | null,"author_user_id"?: string | null,"body"?: string | null,"created_at"?: string,"event_id"?: string,"id"?: string,"is_host"?: boolean,"photo_count"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "wall_posts_author_user_id_fkey"
      columns: ["author_user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "wall_posts_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    }
                  ]
                },"wall_uploads": {
                  Row: {
                    "author_guest_hash": string | null,"author_user_id": string | null,"content_type": string,"created_at": string,"event_id": string,"expires_at": string,"full_path": string | null,"height": number | null,"id": string,"incoming_path": string,"is_host": boolean,"size": number,"status": string,"thumb_path": string | null,"width": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "author_guest_hash"?: string | null,"author_user_id"?: string | null,"content_type": string,"created_at"?: string,"event_id": string,"expires_at"?: string,"full_path"?: string | null,"height"?: number | null,"id"?: string,"incoming_path": string,"is_host"?: boolean,"size": number,"status"?: string,"thumb_path"?: string | null,"width"?: number | null
                  }
                  Update: {
                    "author_guest_hash"?: string | null,"author_user_id"?: string | null,"content_type"?: string,"created_at"?: string,"event_id"?: string,"expires_at"?: string,"full_path"?: string | null,"height"?: number | null,"id"?: string,"incoming_path"?: string,"is_host"?: boolean,"size"?: number,"status"?: string,"thumb_path"?: string | null,"width"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "wall_uploads_author_user_id_fkey"
      columns: ["author_user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "wall_uploads_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "accept_co_host_invite":
{ Args: { "p_token": string }; Returns: string
                           },
"add_group_member":
{ Args: { "p_group_id": string,"p_user_id": string }; Returns: undefined
                           },
"apply_quiet_hours":
{ Args: { "p_ts": string,"p_urgent": boolean }; Returns: string
                           },
"can_moderate_event":
{ Args: { "p_event_id": string,"p_user_id": string }; Returns: boolean
                           },
"can_read_voter":
{ Args: { "p_voter_id": string }; Returns: boolean
                           },
"can_see_event_as_guest":
{ Args: { "p_event_id": string,"p_user_id": string }; Returns: boolean
                           },
"cancel_event_notifications":
{ Args: { "p_event_id": string,"p_except_kind"?: string }; Returns: number
                           },
"claim_deliveries":
{ Args: { "p_limit"?: number,"p_now"?: string }; Returns: Json[]
                           },
"claim_guest_rsvps":
{ Args: { "p_ticket": string }; Returns: Json
                           },
"clean_group_name":
{ Args: { "p_name": string }; Returns: string
                           },
"co_host_slots_used":
{ Args: { "p_event_id": string,"p_now"?: string }; Returns: number
                           },
"complete_delivery":
{ Args: { "p_error"?: string,"p_id": string,"p_now"?: string,"p_outcome": string,"p_provider_id"?: string }; Returns: string
                           },
"create_claim_ticket":
{ Args: { "p_guest_token": string }; Returns: string
                           },
"create_co_host_invite":
{ Args: { "p_event_id": string }; Returns: string
                           },
"create_group":
{ Args: { "p_name": string }; Returns: string
                           },
"create_group_link":
{ Args: { "p_group_id": string }; Returns: string
                           },
"create_poll_event":
{ Args: { "p_closes_at"?: string,"p_event": Json,"p_options": Json }; Returns: Json
                           },
"create_series":
{ Args: { "p_ends_on"?: string,"p_event": Json,"p_frequency": string,"p_group_id": string }; Returns: Json
                           },
"delete_announcement":
{ Args: { "p_id": string }; Returns: undefined
                           },
"delete_group":
{ Args: { "p_group_id": string }; Returns: undefined
                           },
"delivery_backoff":
{ Args: { "p_attempts": number }; Returns: string
                           },
"due_push_receipts":
{ Args: { "p_limit"?: number,"p_now"?: string }; Returns: {
              "delivery_id": string,"ticket_id": string
            }[]
                           },
"email_bounced":
{ Args: { "p_provider_message_id": string }; Returns: boolean
                           },
"email_consent_version":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"end_group_series":
{ Args: { "p_group_id": string }; Returns: undefined
                           },
"end_series":
{ Args: { "p_cancel_upcoming": boolean,"p_series_id": string }; Returns: undefined
                           },
"end_series_now":
{ Args: { "p_cancel_upcoming": boolean,"p_series_id": string }; Returns: undefined
                           },
"enqueue_notification":
{ Args: { "p_audience": string,"p_coalesce_key"?: string,"p_coalesce_mode"?: string,"p_dedupe_key"?: string,"p_event_id": string,"p_exclude_user_id"?: string,"p_kind": string,"p_not_before"?: string,"p_payload"?: Json,"p_subject_id"?: string,"p_target_rsvp_id"?: string,"p_target_user_id"?: string }; Returns: string
                           },
"ensure_series_dates":
{ Args: { "p_limit"?: number,"p_now"?: string,"p_quiet"?: boolean,"p_series_id": string }; Returns: number
                           },
"event_ended_at":
{ Args: { "e": Omit<Database["public"]['Tables']["events"]['Row'], Database["public"]['Tables']["events"]['ComputedFields']> }; Returns: string
                           },
"event_going_heads":
{ Args: { "p_event_id": string }; Returns: number
                           },
"event_spots_left":
{ Args: { "p_event_id": string }; Returns: number
                           },
"fan_out_due_notifications":
{ Args: { "p_limit"?: number,"p_now"?: string }; Returns: number
                           },
"generate_invite_token":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"generate_random_token":
{ Args: { "p_length": number }; Returns: string
                           },
"get_co_host_invite":
{ Args: { "p_token": string }; Returns: Json
                           },
"get_co_host_invite_preview":
{ Args: { "p_token": string }; Returns: Json
                           },
"get_group":
{ Args: { "p_group_id": string }; Returns: Json
                           },
"get_group_link_preview":
{ Args: { "p_token": string }; Returns: Json
                           },
"get_invite":
{ Args: { "p_guest_token"?: string,"p_token": string }; Returns: Json
                           },
"get_my_invite":
{ Args: { "p_event_id": string }; Returns: Json
                           },
"group_event_summary":
{ Args: { "p_event_id": string }; Returns: Json
                           },
"group_role":
{ Args: { "g": Omit<Database["public"]['Tables']["groups"]['Row'], Database["public"]['Tables']["groups"]['ComputedFields']>,"p_user_id": string }; Returns: string
                           },
"group_seats_used":
{ Args: { "p_group_id": string,"p_now"?: string }; Returns: number
                           },
"group_successor":
{ Args: { "p_group_id": string }; Returns: string
                           },
"hand_over_and_leave_group":
{ Args: { "p_group_id": string,"p_new_owner": string }; Returns: undefined
                           },
"hash_claim_ticket":
{ Args: { "p_ticket": string }; Returns: string
                           },
"hash_guest_token":
{ Args: { "p_guest_token": string }; Returns: string
                           },
"hit_rate_limit":
{ Args: { "p_bucket": string,"p_max": number,"p_now"?: string,"p_window_seconds": number }; Returns: boolean
                           },
"invitable_past_guests":
{ Args: { "p_group_id": string }; Returns: Json
                           },
"invite_payload":
{ Args: { "ev": Omit<Database["public"]['Tables']["events"]['Row'], Database["public"]['Tables']["events"]['ComputedFields']>,"me": Omit<Database["public"]['Tables']["rsvps"]['Row'], Database["public"]['Tables']["rsvps"]['ComputedFields']>,"p_guest_device"?: boolean,"p_voter_hash"?: string }; Returns: Json
                           },
"invite_payload_core":
{ Args: { "ev": Omit<Database["public"]['Tables']["events"]['Row'], Database["public"]['Tables']["events"]['ComputedFields']>,"me": Omit<Database["public"]['Tables']["rsvps"]['Row'], Database["public"]['Tables']["rsvps"]['ComputedFields']>,"p_guest_device"?: boolean,"p_voter_hash"?: string }; Returns: Json
                           },
"invite_to_group":
{ Args: { "p_group_id": string,"p_user_ids": (string)[] }; Returns: number
                           },
"is_event_co_host":
{ Args: { "p_event_id": string }; Returns: boolean
                           },
"is_event_host":
{ Args: { "p_event_id": string }; Returns: boolean
                           },
"is_event_manager":
{ Args: { "p_event_id": string }; Returns: boolean
                           },
"is_event_manager_for":
{ Args: { "p_event_id": string,"p_user_id": string }; Returns: boolean
                           },
"is_event_owner":
{ Args: { "p_event_id": string }; Returns: boolean
                           },
"is_group_admin":
{ Args: { "p_group_id": string,"p_user_id"?: string }; Returns: boolean
                           },
"is_group_member":
{ Args: { "p_group_id": string,"p_user_id"?: string }; Returns: boolean
                           },
"is_series_admin":
{ Args: { "p_series_id": string,"p_user_id"?: string }; Returns: boolean
                           },
"join_group_by_link":
{ Args: { "p_token": string }; Returns: string
                           },
"kick_notifications_worker":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"leave_event":
{ Args: { "p_event_id": string }; Returns: boolean
                           },
"leave_group":
{ Args: { "p_group_id": string }; Returns: undefined
                           },
"list_event_hosts":
{ Args: { "p_event_id": string }; Returns: {
              "added_at": string,"avatar_path": string,"display_name": string,"role": string,"user_id": string
            }[]
                           },
"list_group_series":
{ Args: { "p_group_id": string }; Returns: Json
                           },
"list_my_groups":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"list_my_invites":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"lock_event":
{ Args: { "p_event_id": string }; Returns: {
              "allow_plus_ones": boolean,
"cancelled_at": string | null,
"capacity": number | null,
"cover_path": string | null,
"created_at": string,
"date_picked_at": string | null,
"description": string | null,
"ends_at": string | null,
"group_id": string | null,
"guest_list_visible": boolean,
"host_id": string,
"id": string,
"latitude": number | null,
"location_point": unknown,
"location_text": string,
"longitude": number | null,
"max_plus_ones": number,
"occurrence_index": number | null,
"place_name": string | null,
"poll_closes_at": string | null,
"series_id": string | null,
"starts_at": string | null,
"theme": string,
"time_changed_at": string | null,
"time_zone": string,
"title": string,
"updated_at": string,
"wall_enabled": boolean
            }
                          SetofOptions: {
        from: "*"
        to: "events"
        isOneToOne: true
        isSetofReturn: false
      } },
"lock_event_for_token":
{ Args: { "p_token": string }; Returns: {
              "allow_plus_ones": boolean,
"cancelled_at": string | null,
"capacity": number | null,
"cover_path": string | null,
"created_at": string,
"date_picked_at": string | null,
"description": string | null,
"ends_at": string | null,
"group_id": string | null,
"guest_list_visible": boolean,
"host_id": string,
"id": string,
"latitude": number | null,
"location_point": unknown,
"location_text": string,
"longitude": number | null,
"max_plus_ones": number,
"occurrence_index": number | null,
"place_name": string | null,
"poll_closes_at": string | null,
"series_id": string | null,
"starts_at": string | null,
"theme": string,
"time_changed_at": string | null,
"time_zone": string,
"title": string,
"updated_at": string,
"wall_enabled": boolean
            }
                          SetofOptions: {
        from: "*"
        to: "events"
        isOneToOne: true
        isSetofReturn: false
      } },
"lock_group_for":
{ Args: { "p_group_id": string,"p_role": string }; Returns: {
              "created_at": string,
"id": string,
"name": string,
"owner_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "groups"
        isOneToOne: true
        isSetofReturn: false
      } },
"lock_open_event":
{ Args: { "p_event_id": string }; Returns: {
              "allow_plus_ones": boolean,
"cancelled_at": string | null,
"capacity": number | null,
"cover_path": string | null,
"created_at": string,
"date_picked_at": string | null,
"description": string | null,
"ends_at": string | null,
"group_id": string | null,
"guest_list_visible": boolean,
"host_id": string,
"id": string,
"latitude": number | null,
"location_point": unknown,
"location_text": string,
"longitude": number | null,
"max_plus_ones": number,
"occurrence_index": number | null,
"place_name": string | null,
"poll_closes_at": string | null,
"series_id": string | null,
"starts_at": string | null,
"theme": string,
"time_changed_at": string | null,
"time_zone": string,
"title": string,
"updated_at": string,
"wall_enabled": boolean
            }
                          SetofOptions: {
        from: "*"
        to: "events"
        isOneToOne: true
        isSetofReturn: false
      } },
"lock_series":
{ Args: { "p_series_id": string }; Returns: {
              "allow_plus_ones": boolean,
"anchor_index": number,
"anchor_local_date": string,
"capacity": number | null,
"cover_path": string | null,
"created_at": string,
"created_by": string | null,
"description": string | null,
"duration": string | null,
"ended_at": string | null,
"ends_on": string | null,
"frequency": string,
"group_id": string,
"guest_list_visible": boolean,
"id": string,
"latitude": number | null,
"local_start_time": string,
"location_text": string,
"longitude": number | null,
"max_plus_ones": number,
"next_index": number,
"place_name": string | null,
"theme": string,
"time_zone": string,
"title": string,
"updated_at": string,
"wall_enabled": boolean
            }
                          SetofOptions: {
        from: "*"
        to: "event_series"
        isOneToOne: true
        isSetofReturn: false
      } },
"lock_series_for_event":
{ Args: { "p_event_id": string }; Returns: {
              "allow_plus_ones": boolean,
"anchor_index": number,
"anchor_local_date": string,
"capacity": number | null,
"cover_path": string | null,
"created_at": string,
"created_by": string | null,
"description": string | null,
"duration": string | null,
"ended_at": string | null,
"ends_on": string | null,
"frequency": string,
"group_id": string,
"guest_list_visible": boolean,
"id": string,
"latitude": number | null,
"local_start_time": string,
"location_text": string,
"longitude": number | null,
"max_plus_ones": number,
"next_index": number,
"place_name": string | null,
"theme": string,
"time_zone": string,
"title": string,
"updated_at": string,
"wall_enabled": boolean
            }
                          SetofOptions: {
        from: "*"
        to: "event_series"
        isOneToOne: true
        isSetofReturn: false
      } },
"mask_email":
{ Args: { "p_email": string }; Returns: string
                           },
"max_active_series":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"max_announcements_per_day":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"max_co_hosts":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"max_group_members":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"max_owned_groups":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"max_poll_options":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"max_rsvps_per_event":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"merge_notification_payload":
{ Args: { "p_new": Json,"p_old": Json }; Returns: Json
                           },
"min_poll_options":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"move_group_series_owner":
{ Args: { "p_group_id": string,"p_new_owner": string }; Returns: undefined
                           },
"my_votes_json":
{ Args: { "p_voter_id": string }; Returns: Json
                           },
"notification_is_urgent":
{ Args: { "n": Omit<Database["public"]['Tables']["notifications"]['Row'], Database["public"]['Tables']["notifications"]['ComputedFields']>,"p_now": string }; Returns: boolean
                           },
"notification_recipients":
{ Args: { "n": Omit<Database["public"]['Tables']["notifications"]['Row'], Database["public"]['Tables']["notifications"]['ComputedFields']> }; Returns: {
              "channel": string,"push_token_id": string,"rsvp_id": string,"user_id": string
            }[]
                           },
"notification_stale_reason":
{ Args: { "n": Omit<Database["public"]['Tables']["notifications"]['Row'], Database["public"]['Tables']["notifications"]['ComputedFields']>,"p_now": string }; Returns: string
                           },
"open_co_host_invite":
{ Args: { "p_lock"?: boolean,"p_token": string }; Returns: {
              "accepted_at": string | null,
"accepted_by": string | null,
"created_at": string,
"event_id": string,
"expires_at": string,
"revoked_at": string | null,
"token": string
            }
                          SetofOptions: {
        from: "*"
        to: "co_host_invites"
        isOneToOne: true
        isSetofReturn: false
      } },
"open_event_for_token":
{ Args: { "p_token": string }; Returns: {
              "allow_plus_ones": boolean,
"cancelled_at": string | null,
"capacity": number | null,
"cover_path": string | null,
"created_at": string,
"date_picked_at": string | null,
"description": string | null,
"ends_at": string | null,
"group_id": string | null,
"guest_list_visible": boolean,
"host_id": string,
"id": string,
"latitude": number | null,
"location_point": unknown,
"location_text": string,
"longitude": number | null,
"max_plus_ones": number,
"occurrence_index": number | null,
"place_name": string | null,
"poll_closes_at": string | null,
"series_id": string | null,
"starts_at": string | null,
"theme": string,
"time_changed_at": string | null,
"time_zone": string,
"title": string,
"updated_at": string,
"wall_enabled": boolean
            }
                          SetofOptions: {
        from: "*"
        to: "events"
        isOneToOne: true
        isSetofReturn: false
      } },
"pass_on_owned_groups":
{ Args: { "p_user_id": string }; Returns: undefined
                           },
"pick_poll_option":
{ Args: { "p_option_id": string }; Returns: Json
                           },
"poll_payload":
{ Args: { "p_event_id": string }; Returns: Json
                           },
"post_announcement":
{ Args: { "p_body": string,"p_event_id": string }; Returns: Json
                           },
"promote_from_waitlist":
{ Args: { "p_event_id": string }; Returns: string[]
                           },
"promote_waitlisted":
{ Args: { "p_over_capacity"?: boolean,"p_rsvp_id": string }; Returns: Json
                           },
"random_url_token":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"record_push_receipt":
{ Args: { "p_delivery_id": string,"p_error"?: string,"p_now"?: string,"p_status": string }; Returns: undefined
                           },
"regenerate_invite":
{ Args: { "p_event_id": string }; Returns: string
                           },
"register_push_token":
{ Args: { "p_locale"?: string,"p_platform": string,"p_token": string }; Returns: undefined
                           },
"remove_co_host":
{ Args: { "p_event_id": string,"p_user_id": string }; Returns: boolean
                           },
"remove_group_member":
{ Args: { "p_group_id": string,"p_user_id": string }; Returns: undefined
                           },
"remove_rsvp":
{ Args: { "p_rsvp_id": string }; Returns: boolean
                           },
"rename_group":
{ Args: { "p_group_id": string,"p_name": string }; Returns: undefined
                           },
"require_uid":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"respond_group_invitation":
{ Args: { "p_accept": boolean,"p_group_id": string }; Returns: undefined
                           },
"revoke_co_host_invite":
{ Args: { "p_token": string }; Returns: undefined
                           },
"revoke_group_link":
{ Args: { "p_group_id": string }; Returns: undefined
                           },
"rsvp_as_user":
{ Args: { "p_plus_ones"?: number,"p_status": Database["public"]['Enums']["rsvp_status"],"p_token": string }; Returns: Json
                           },
"rsvp_result":
{ Args: { "p_rsvp_id": string }; Returns: Json
                           },
"run_retention":
{ Args: { "p_now"?: string }; Returns: undefined
                           },
"run_series_dates":
{ Args: { "p_now"?: string }; Returns: number
                           },
"save_ballot_locked":
{ Args: { "ev": Omit<Database["public"]['Tables']["events"]['Row'], Database["public"]['Tables']["events"]['ComputedFields']>,"p_display_name": string,"p_guest_hash": string,"p_user_id": string,"p_votes": Json }; Returns: Json
                           },
"save_rsvp_locked":
{ Args: { "ev": Omit<Database["public"]['Tables']["events"]['Row'], Database["public"]['Tables']["events"]['ComputedFields']>,"p_display_name": string,"p_existing_only"?: boolean,"p_guest_hash": string,"p_plus_ones": number,"p_rename": boolean,"p_status": Database["public"]['Enums']["rsvp_status"],"p_user_id": string }; Returns: {
              "created_at": string,
"display_name": string,
"event_id": string,
"guest_token_hash": string | null,
"id": string,
"plus_ones": number,
"promoted_at": string | null,
"status": Database["public"]['Enums']["rsvp_status"],
"updated_at": string,
"user_id": string | null,
"waitlisted_at": string | null
            }
                          SetofOptions: {
        from: "*"
        to: "rsvps"
        isOneToOne: true
        isSetofReturn: false
      } },
"schedule_event_reminder":
{ Args: { "p_event": Omit<Database["public"]['Tables']["events"]['Row'], Database["public"]['Tables']["events"]['ComputedFields']>,"p_now"?: string }; Returns: string
                           },
"series_date_start":
{ Args: { "k": number,"s": Omit<Database["public"]['Tables']["event_series"]['Row'], Database["public"]['Tables']["event_series"]['ComputedFields']> }; Returns: string
                           },
"series_local_date":
{ Args: { "k": number,"s": Omit<Database["public"]['Tables']["event_series"]['Row'], Database["public"]['Tables']["event_series"]['ComputedFields']> }; Returns: string
                           },
"series_upcoming_dates":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"set_group_admin":
{ Args: { "p_admin": boolean,"p_group_id": string,"p_user_id": string }; Returns: undefined
                           },
"set_my_rsvp":
{ Args: { "p_event_id": string,"p_plus_ones"?: number,"p_status": Database["public"]['Enums']["rsvp_status"] }; Returns: Json
                           },
"set_poll_options":
{ Args: { "p_closes_at"?: string,"p_event_id": string,"p_options": Json }; Returns: number
                           },
"set_series_rpc":
{ Args: { "p_on": boolean }; Returns: undefined
                           },
"storage_queue_claim":
{ Args: { "p_limit"?: number,"p_now"?: string }; Returns: {
              "attempts": number,"bucket": string,"id": number,"path": string
            }[]
                           },
"storage_queue_done":
{ Args: { "p_ids": (number)[] }; Returns: number
                           },
"storage_queue_failed":
{ Args: { "p_error": string,"p_ids": (number)[] }; Returns: undefined
                           },
"submit_votes":
{ Args: { "p_display_name": string,"p_guest_token": string,"p_token": string,"p_votes": Json }; Returns: Json
                           },
"transfer_group_ownership":
{ Args: { "p_enforce_limit": boolean,"p_group_id": string,"p_new_owner": string }; Returns: undefined
                           },
"try_uuid":
{ Args: { "p_text": string }; Returns: string
                           },
"unregister_push_token":
{ Args: { "p_token": string }; Returns: boolean
                           },
"unsubscribe_email":
{ Args: { "p_token": string }; Returns: undefined
                           },
"update_series_from":
{ Args: { "p_event_id": string,"p_patch": Json }; Returns: number
                           },
"update_series_rule":
{ Args: { "p_ends_on": string,"p_frequency": string,"p_series_id": string }; Returns: undefined
                           },
"upsert_rsvp":
{ Args: { "p_display_name": string,"p_email"?: string,"p_email_action"?: string,"p_email_hash"?: string,"p_guest_token": string,"p_locale"?: string,"p_plus_ones"?: number,"p_status": Database["public"]['Enums']["rsvp_status"],"p_token": string }; Returns: Json
                           },
"valid_cover_for":
{ Args: { "p_cover": string,"p_event_id"?: string,"p_uid": string }; Returns: boolean
                           },
"validate_poll_options":
{ Args: { "p_closes_at": string,"p_keep"?: (string)[],"p_old_closes_at"?: string,"p_options": Json }; Returns: undefined
                           },
"vote_as_user":
{ Args: { "p_token": string,"p_votes": Json }; Returns: Json
                           },
"waitlist_position":
{ Args: { "p_rsvp_id": string }; Returns: number
                           },
"wall_actor_for":
{ Args: { "p_event_id": string,"p_guest_hash": string,"p_user_id": string }; Returns: Database["public"]['CompositeTypes']["wall_actor"]
                          SetofOptions: {
        from: "*"
        to: "wall_actor"
        isOneToOne: true
        isSetofReturn: false
      } },
"wall_actor_photo_count":
{ Args: { "a": Database["public"]['CompositeTypes']["wall_actor"],"p_event_id": string,"p_now"?: string }; Returns: number
                           },
"wall_block_author":
{ Args: { "p_event_id": string,"p_post_id": string,"p_user_id": string }; Returns: Json
                           },
"wall_can_post":
{ Args: { "p_event_id": string,"p_guest_hash": string,"p_now"?: string,"p_user_id": string }; Returns: string
                           },
"wall_claim_upload":
{ Args: { "p_event_id": string,"p_guest_token": string,"p_token": string,"p_upload_id": string,"p_user_id": string }; Returns: Json
                           },
"wall_create_post":
{ Args: { "p_body": string,"p_event_id": string,"p_guest_token": string,"p_token": string,"p_upload_ids"?: (string)[],"p_user_id": string }; Returns: Json
                           },
"wall_delete_mine":
{ Args: { "p_event_id": string,"p_guest_token": string,"p_token": string,"p_user_id": string }; Returns: Json
                           },
"wall_delete_post":
{ Args: { "p_all_by_author"?: boolean,"p_event_id": string,"p_guest_token": string,"p_post_id": string,"p_token": string,"p_user_id": string }; Returns: Json
                           },
"wall_enqueue_orphans":
{ Args: { "p_now"?: string }; Returns: number
                           },
"wall_event":
{ Args: { "p_event_id": string,"p_token": string,"p_user_id": string }; Returns: {
              "allow_plus_ones": boolean,
"cancelled_at": string | null,
"capacity": number | null,
"cover_path": string | null,
"created_at": string,
"date_picked_at": string | null,
"description": string | null,
"ends_at": string | null,
"group_id": string | null,
"guest_list_visible": boolean,
"host_id": string,
"id": string,
"latitude": number | null,
"location_point": unknown,
"location_text": string,
"longitude": number | null,
"max_plus_ones": number,
"occurrence_index": number | null,
"place_name": string | null,
"poll_closes_at": string | null,
"series_id": string | null,
"starts_at": string | null,
"theme": string,
"time_changed_at": string | null,
"time_zone": string,
"title": string,
"updated_at": string,
"wall_enabled": boolean
            }
                          SetofOptions: {
        from: "*"
        to: "events"
        isOneToOne: true
        isSetofReturn: false
      } },
"wall_feed":
{ Args: { "p_before_created_at"?: string,"p_before_id"?: string,"p_event_id"?: string,"p_guest_token"?: string,"p_limit"?: number,"p_token"?: string,"p_user_id"?: string }; Returns: Json
                           },
"wall_guest_hash":
{ Args: { "p_guest_token": string }; Returns: string
                           },
"wall_is_blocked":
{ Args: { "a": Database["public"]['CompositeTypes']["wall_actor"],"p_event_id": string }; Returns: boolean
                           },
"wall_limits":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"wall_mark_upload":
{ Args: { "p_full_path"?: string,"p_height"?: number,"p_status": string,"p_thumb_path"?: string,"p_upload_id": string,"p_width"?: number }; Returns: boolean
                           },
"wall_post_reason":
{ Args: { "a": Database["public"]['CompositeTypes']["wall_actor"],"ev": Omit<Database["public"]['Tables']["events"]['Row'], Database["public"]['Tables']["events"]['ComputedFields']>,"p_now"?: string }; Returns: string
                           },
"wall_queue_for":
{ Args: { "p_paths": (string)[] }; Returns: Json
                           },
"wall_reserve_upload":
{ Args: { "p_content_type": string,"p_event_id": string,"p_guest_token": string,"p_size": number,"p_token": string,"p_user_id": string }; Returns: Json
                           },
"wall_set_enabled":
{ Args: { "p_enabled": boolean,"p_event_id": string,"p_user_id": string }; Returns: boolean
                           },
"wall_unblock":
{ Args: { "p_block_id": string,"p_event_id": string,"p_user_id": string }; Returns: boolean
                           },
"withdraw_rsvp":
{ Args: { "p_guest_token": string,"p_token": string }; Returns: boolean
                           },
"withdraw_votes":
{ Args: { "p_guest_token": string,"p_token": string }; Returns: boolean
                           },
"withdraw_votes_as_user":
{ Args: { "p_token": string }; Returns: boolean
                           }
          }
          Enums: {
            "rsvp_status": "going"|"maybe"|"declined"|"waitlisted","vote_choice": "yes"|"if_needed"|"no"
          }
          CompositeTypes: {
            "wall_actor": {
                        "user_id": string | null,"guest_hash": string | null,"is_host": boolean | null,"status": Database["public"]['Enums']["rsvp_status"] | null,"display_name": string | null
                      }
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
            "rsvp_status": ["going", "maybe", "declined", "waitlisted"],"vote_choice": ["yes", "if_needed", "no"]
          }
        }
} as const
