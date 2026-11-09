
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
                },"events": {
                  Row: {
                    "allow_plus_ones": boolean,"cancelled_at": string | null,"capacity": number | null,"cover_path": string | null,"created_at": string,"date_picked_at": string | null,"description": string | null,"ends_at": string | null,"guest_list_visible": boolean,"host_id": string,"id": string,"latitude": number | null,"location_point": unknown,"location_text": string,"longitude": number | null,"max_plus_ones": number,"place_name": string | null,"poll_closes_at": string | null,"starts_at": string | null,"theme": string,"time_changed_at": string | null,"time_zone": string,"title": string,"updated_at": string,"event_ended_at": string | null
                  }
                  ComputedFields: "event_ended_at"
                  Insert: {
                    "allow_plus_ones"?: boolean,"cancelled_at"?: string | null,"capacity"?: number | null,"cover_path"?: string | null,"created_at"?: string,"date_picked_at"?: string | null,"description"?: string | null,"ends_at"?: string | null,"guest_list_visible"?: boolean,"host_id"?: string,"id"?: string,"latitude"?: number | null,"location_point"?: never,"location_text": string,"longitude"?: number | null,"max_plus_ones"?: number,"place_name"?: string | null,"poll_closes_at"?: string | null,"starts_at"?: string | null,"theme"?: string,"time_changed_at"?: string | null,"time_zone"?: string,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "allow_plus_ones"?: boolean,"cancelled_at"?: string | null,"capacity"?: number | null,"cover_path"?: string | null,"created_at"?: string,"date_picked_at"?: string | null,"description"?: string | null,"ends_at"?: string | null,"guest_list_visible"?: boolean,"host_id"?: string,"id"?: string,"latitude"?: number | null,"location_point"?: never,"location_text"?: string,"longitude"?: number | null,"max_plus_ones"?: number,"place_name"?: string | null,"poll_closes_at"?: string | null,"starts_at"?: string | null,"theme"?: string,"time_changed_at"?: string | null,"time_zone"?: string,"title"?: string,"updated_at"?: string
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
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "accept_co_host_invite":
{ Args: { "p_token": string }; Returns: string
                           },
"apply_quiet_hours":
{ Args: { "p_ts": string,"p_urgent": boolean }; Returns: string
                           },
"can_read_voter":
{ Args: { "p_voter_id": string }; Returns: boolean
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
"create_poll_event":
{ Args: { "p_closes_at"?: string,"p_event": Json,"p_options": Json }; Returns: Json
                           },
"delete_announcement":
{ Args: { "p_id": string }; Returns: undefined
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
"enqueue_notification":
{ Args: { "p_audience": string,"p_coalesce_key"?: string,"p_coalesce_mode"?: string,"p_dedupe_key"?: string,"p_event_id": string,"p_exclude_user_id"?: string,"p_kind": string,"p_not_before"?: string,"p_payload"?: Json,"p_subject_id"?: string,"p_target_rsvp_id"?: string,"p_target_user_id"?: string }; Returns: string
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
"get_invite":
{ Args: { "p_guest_token"?: string,"p_token": string }; Returns: Json
                           },
"get_my_invite":
{ Args: { "p_event_id": string }; Returns: Json
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
"invite_payload":
{ Args: { "ev": Omit<Database["public"]['Tables']["events"]['Row'], Database["public"]['Tables']["events"]['ComputedFields']>,"me": Omit<Database["public"]['Tables']["rsvps"]['Row'], Database["public"]['Tables']["rsvps"]['ComputedFields']>,"p_guest_device"?: boolean,"p_voter_hash"?: string }; Returns: Json
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
"kick_notifications_worker":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"leave_event":
{ Args: { "p_event_id": string }; Returns: boolean
                           },
"list_event_hosts":
{ Args: { "p_event_id": string }; Returns: {
              "added_at": string,"avatar_path": string,"display_name": string,"role": string,"user_id": string
            }[]
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
"guest_list_visible": boolean,
"host_id": string,
"id": string,
"latitude": number | null,
"location_point": unknown,
"location_text": string,
"longitude": number | null,
"max_plus_ones": number,
"place_name": string | null,
"poll_closes_at": string | null,
"starts_at": string | null,
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
"guest_list_visible": boolean,
"host_id": string,
"id": string,
"latitude": number | null,
"location_point": unknown,
"location_text": string,
"longitude": number | null,
"max_plus_ones": number,
"place_name": string | null,
"poll_closes_at": string | null,
"starts_at": string | null,
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
"guest_list_visible": boolean,
"host_id": string,
"id": string,
"latitude": number | null,
"location_point": unknown,
"location_text": string,
"longitude": number | null,
"max_plus_ones": number,
"place_name": string | null,
"poll_closes_at": string | null,
"starts_at": string | null,
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
"mask_email":
{ Args: { "p_email": string }; Returns: string
                           },
"max_announcements_per_day":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"max_co_hosts":
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
"guest_list_visible": boolean,
"host_id": string,
"id": string,
"latitude": number | null,
"location_point": unknown,
"location_text": string,
"longitude": number | null,
"max_plus_ones": number,
"place_name": string | null,
"poll_closes_at": string | null,
"starts_at": string | null,
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
"remove_rsvp":
{ Args: { "p_rsvp_id": string }; Returns: boolean
                           },
"revoke_co_host_invite":
{ Args: { "p_token": string }; Returns: undefined
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
"set_my_rsvp":
{ Args: { "p_event_id": string,"p_plus_ones"?: number,"p_status": Database["public"]['Enums']["rsvp_status"] }; Returns: Json
                           },
"set_poll_options":
{ Args: { "p_closes_at"?: string,"p_event_id": string,"p_options": Json }; Returns: number
                           },
"submit_votes":
{ Args: { "p_display_name": string,"p_guest_token": string,"p_token": string,"p_votes": Json }; Returns: Json
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
"upsert_rsvp":
{ Args: { "p_display_name": string,"p_email"?: string,"p_email_action"?: string,"p_email_hash"?: string,"p_guest_token": string,"p_locale"?: string,"p_plus_ones"?: number,"p_status": Database["public"]['Enums']["rsvp_status"],"p_token": string }; Returns: Json
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
            "rsvp_status": ["going", "maybe", "declined", "waitlisted"],"vote_choice": ["yes", "if_needed", "no"]
          }
        }
} as const
