/**
 * Generated client<->DB RPC contract map: for each RPC the deployed Angular client
 * (origin/develop) calls, the named args it sends. Consumed by rpc-contract.spec.ts.
 *
 * Regenerate when client .rpc() calls change. `sends` = always passed; `sometimes` =
 * passed conditionally (e.g. omitted when null) or only by some of several call sites.
 * create_event is pinned to the cutover createEvent() shape (legacy pre-cutover
 * create()/marker.create() paths are excluded as dead code).
 */
export interface RpcContract {
  rpc: string;
  sends: string[];
  sometimes?: string[];
  source: string;
}

export const RPC_CONTRACTS: RpcContract[] = [
  {
    rpc: 'accept_invite',
    sends: ['p_code'],
    source: 'tenant.service.ts:joinByCode',
  },
  {
    rpc: 'accept_space_invite',
    sends: ['p_code'],
    source: 'space.service.ts:acceptSpaceInviteByCode',
  },
  {
    rpc: 'add_agency_member',
    sends: ['p_agency_id', 'p_email', 'p_role'],
    source: 'agency.service.ts:addAgencyMemberByEmail',
  },
  {
    rpc: 'add_tenant_owner',
    sends: ['p_tenant_id', 'p_email'],
    source: 'tenant.service.ts:addTenantOwner',
  },
  {
    rpc: 'archive_space',
    sends: ['p_space_id'],
    source: 'space.service.ts:archiveSpace',
  },
  {
    rpc: 'check_subdomain_available',
    sends: ['p_subdomain'],
    source:
      'agency.service.ts:checkSubdomainAvailable + super-admin.service.ts:checkSubdomainAvailable (identical args)',
  },
  {
    rpc: 'commit_source_import',
    sends: [
      'p_space_id',
      'p_ai_call_id',
      'p_source_document',
      'p_proposal',
      'p_inventory_snapshot_hash',
    ],
    source: 'review-page.component.ts:doCommit (line 1214)',
  },
  {
    rpc: 'create_asset',
    sends: ['p_space_id', 'p_company_id', 'p_name', 'p_generic_name', 'p_moa_names', 'p_roa_names'],
    source: 'asset.service.ts:create',
  },
  {
    rpc: 'create_company',
    sends: ['p_space_id', 'p_name', 'p_logo_url'],
    source: 'company.service.ts:create',
  },
  {
    rpc: 'create_event',
    sends: [
      'p_space_id',
      'p_event_type_id',
      'p_title',
      'p_event_date',
      'p_anchor_type',
      'p_anchor_id',
      'p_projection',
      'p_date_precision',
      'p_end_date',
      'p_end_date_precision',
      'p_is_ongoing',
      'p_description',
      'p_significance',
      'p_visibility',
      'p_sources',
    ],
    sometimes: ['p_metadata'],
    source:
      'event.service.ts:createEvent (cutover shape; legacy create()/marker.create() dead pre-cutover paths excluded)',
  },
  {
    rpc: 'create_space',
    sends: ['p_tenant_id', 'p_name', 'p_description'],
    source: 'space.service.ts:createSpace',
  },
  {
    rpc: 'create_trial',
    sends: [
      'p_space_id',
      'p_asset_id',
      'p_name',
      'p_identifier',
      'p_status',
      'p_phase_type',
      'p_phase_start_date',
      'p_phase_end_date',
    ],
    source: 'trial.service.ts:create',
  },
  {
    rpc: 'delete_agency',
    sends: ['p_agency_id'],
    source: 'super-admin.service.ts:deleteAgency',
  },
  {
    rpc: 'delete_change_event_annotation',
    sends: ['p_change_event_id'],
    source: 'annotation.service.ts:delete()',
  },
  {
    rpc: 'delete_material',
    sends: ['p_id'],
    source: 'material.service.ts:delete',
  },
  {
    rpc: 'delete_primary_intelligence',
    sends: ['p_id'],
    source: 'primary-intelligence.service.ts:delete',
  },
  {
    rpc: 'discard_pending_material',
    sends: ['p_material_id'],
    source: 'material.service.ts:discardPending',
  },
  {
    rpc: 'export_audit_events_csv',
    sends: ['p_scope_kind', 'p_scope_id', 'p_actor_user_id', 'p_action', 'p_from', 'p_to'],
    source: 'audit-event.service.ts:exportCsv',
  },
  {
    rpc: 'finalize_material',
    sends: ['p_material_id'],
    source: 'material.service.ts:finalize',
  },
  {
    rpc: 'get_activity_feed',
    sends: ['p_space_id', 'p_filters', 'p_cursor_observed_at', 'p_cursor_id', 'p_limit'],
    source: 'change-event.service.ts:getActivityFeed',
  },
  {
    rpc: 'get_ai_call_detail',
    sends: ['p_ai_call_id'],
    source: 'super-admin-ai-usage.component.ts:949 (loadCallDetail)',
  },
  {
    rpc: 'get_ai_usage_rollup',
    sends: ['p_scope', 'p_id', 'p_window'],
    source:
      'super-admin-ai-usage.component.ts:1010 (loadData) — p_id value may be null but key always present',
  },
  {
    rpc: 'get_asset_detail_with_intelligence',
    sends: ['p_asset_id'],
    source: 'primary-intelligence.service.ts:getAssetDetail',
  },
  {
    rpc: 'get_brand_by_host',
    sends: ['p_host'],
    source: 'marketing-landing.component.ts:172',
  },
  {
    rpc: 'get_bullseye_assets',
    sends: [
      'p_space_id',
      'p_indication_ids',
      'p_company_ids',
      'p_moa_ids',
      'p_roa_ids',
      'p_phases',
      'p_asset_ids',
      'p_trial_ids',
    ],
    source: 'landscape.service.ts:getBullseyeAssets',
  },
  {
    rpc: 'get_bullseye_by_company',
    sends: ['p_space_id', 'p_company_id'],
    source: 'landscape.service.ts:getBullseyeData (dimension=company)',
  },
  {
    rpc: 'get_bullseye_by_moa',
    sends: ['p_space_id', 'p_moa_id'],
    source: 'landscape.service.ts:getBullseyeData (dimension=moa)',
  },
  {
    rpc: 'get_bullseye_by_roa',
    sends: ['p_space_id', 'p_roa_id'],
    source: 'landscape.service.ts:getBullseyeData (dimension=roa)',
  },
  {
    rpc: 'get_bullseye_data',
    sends: ['p_space_id', 'p_indication_id'],
    source: 'landscape.service.ts:getBullseyeData (dimension=indication; paramKey computed)',
  },
  {
    rpc: 'get_company_detail_with_intelligence',
    sends: ['p_company_id'],
    source: 'primary-intelligence.service.ts:getCompanyDetail',
  },
  {
    rpc: 'get_dashboard_data',
    sends: [
      'p_space_id',
      'p_company_ids',
      'p_asset_ids',
      'p_indication_ids',
      'p_start_year',
      'p_end_year',
      'p_recruitment_statuses',
      'p_study_types',
      'p_phases',
      'p_mechanism_of_action_ids',
      'p_route_of_administration_ids',
    ],
    source: 'dashboard.service.ts:getDashboardData',
  },
  {
    rpc: 'get_event_detail',
    sends: ['p_event_id'],
    source: 'event.service.ts:getEventDetail()',
  },
  {
    rpc: 'get_events_page_data',
    sends: ['p_space_id', 'p_limit'],
    sometimes: [
      'p_date_from',
      'p_date_to',
      'p_entity_level',
      'p_entity_id',
      'p_category_names',
      'p_tags',
      'p_priority',
      'p_source_type',
      'p_offset',
      'p_search',
      'p_sort_field',
      'p_sort_dir',
      'p_change_event_id',
    ],
    source: 'event.service.ts:getEventsPageData()+getDetectedEvent()',
  },
  {
    rpc: 'get_intelligence_notes_for_asset',
    sends: ['p_space_id', 'p_asset_id'],
    source: 'primary-intelligence.service.ts:getIntelligenceNotesForAsset',
  },
  {
    rpc: 'get_landscape_index',
    sends: ['p_space_id'],
    source: 'landscape.service.ts:getLandscapeIndex (dimension=indication)',
  },
  {
    rpc: 'get_landscape_index_by_company',
    sends: ['p_space_id'],
    source: 'landscape.service.ts:getLandscapeIndex (dimension=company)',
  },
  {
    rpc: 'get_landscape_index_by_moa',
    sends: ['p_space_id'],
    source: 'landscape.service.ts:getLandscapeIndex (dimension=moa)',
  },
  {
    rpc: 'get_landscape_index_by_roa',
    sends: ['p_space_id'],
    source: 'landscape.service.ts:getLandscapeIndex (dimension=roa)',
  },
  {
    rpc: 'get_marker_history',
    sends: ['p_marker_id'],
    source: 'change-event.service.ts:getMarkerHistory',
  },
  {
    rpc: 'get_positioning_data',
    sends: [
      'p_space_id',
      'p_grouping',
      'p_count_unit',
      'p_company_ids',
      'p_asset_ids',
      'p_indication_ids',
      'p_mechanism_of_action_ids',
      'p_route_of_administration_ids',
      'p_phases',
      'p_recruitment_statuses',
      'p_study_types',
    ],
    source: 'landscape.service.ts:getHeatmapData',
  },
  {
    rpc: 'get_primary_intelligence_history',
    sends: ['p_anchor_id'],
    source: 'primary-intelligence.service.ts:loadHistory',
  },
  {
    rpc: 'get_source_document',
    sends: ['p_source_doc_id'],
    source: 'source-provenance.service.ts:getSourceDocument',
  },
  {
    rpc: 'get_space_intelligence',
    sends: ['p_space_id'],
    source: 'primary-intelligence.service.ts:getSpaceIntelligence',
  },
  {
    rpc: 'get_space_landing_stats',
    sends: ['p_space_id'],
    source: 'engagement-landing.service.ts:getStats',
  },
  {
    rpc: 'get_space_tags',
    sends: ['p_space_id'],
    source: 'event.service.ts:getSpaceTags()',
  },
  {
    rpc: 'get_tenant_access_settings',
    sends: ['p_tenant_id'],
    source: 'tenant.service.ts:getTenantAccessSettings',
  },
  {
    rpc: 'get_tenant_ai_status',
    sends: ['p_tenant_id'],
    source: 'import-page.component.ts:fetchQuotaStatus (line 459)',
  },
  {
    rpc: 'get_trial_activity',
    sends: ['p_trial_id', 'p_limit'],
    source: 'change-event.service.ts:getTrialActivity',
  },
  {
    rpc: 'get_trial_detail_with_intelligence',
    sends: ['p_trial_id'],
    source: 'primary-intelligence.service.ts:getTrialDetail',
  },
  {
    rpc: 'get_trial_indications',
    sends: ['p_trial_id'],
    source: 'trial.service.ts:listIndications',
  },
  {
    rpc: 'has_space_access',
    sends: ['p_space_id'],
    sometimes: ['p_roles'],
    source:
      'space.guard.ts (p_space_id only); audit-space.guard.ts/edit.guard.ts/space-owner.guard.ts (add p_roles)',
  },
  {
    rpc: 'has_tenant_access',
    sends: ['p_tenant_id'],
    source: 'tenant.guard.ts; marketing-landing.guard.ts',
  },
  {
    rpc: 'invite_to_space',
    sends: ['p_space_id', 'p_email', 'p_role'],
    source: 'space.service.ts:inviteToSpace',
  },
  {
    rpc: 'is_agency_member',
    sends: ['p_agency_id'],
    sometimes: ['p_roles'],
    source: 'engagement-landing.service.ts:isAgencyMemberOfTenant',
  },
  {
    rpc: 'is_agency_member_of_space',
    sends: ['p_space_id'],
    source: 'space-role.service.ts:fetchRole',
  },
  {
    rpc: 'is_platform_admin',
    sends: [],
    source:
      'agency.guard.ts; marketing-landing.guard.ts; super-admin.guard.ts; space-general.component.ts:293; space-archived-list.component.ts:212 — all call with no args',
  },
  {
    rpc: 'is_tenant_member',
    sends: ['p_tenant_id'],
    source: 'tenant-settings.guard.ts',
  },
  {
    rpc: 'is_tenant_owner_strict',
    sends: ['p_tenant_id'],
    source: 'space-general.component.ts:293; space-archived-list.component.ts:211',
  },
  {
    rpc: 'list_agency_members',
    sends: ['p_agency_id'],
    source: 'agency.service.ts:listAgencyMembers',
  },
  {
    rpc: 'list_audit_events',
    sends: [
      'p_scope_kind',
      'p_scope_id',
      'p_actor_user_id',
      'p_action',
      'p_from',
      'p_to',
      'p_limit',
      'p_offset',
    ],
    source: 'audit-event.service.ts:list',
  },
  {
    rpc: 'list_draft_intelligence_for_space',
    sends: ['p_space_id', 'p_limit'],
    source: 'primary-intelligence.service.ts:listDraftsForSpace',
  },
  {
    rpc: 'list_intelligence_for_entity',
    sends: ['p_space_id', 'p_entity_type', 'p_entity_id'],
    source: 'primary-intelligence.service.ts:listIntelligenceForEntity',
  },
  {
    rpc: 'list_latest_snapshots_for_space',
    sends: ['p_space_id'],
    source: 'trial.service.ts:getLatestSnapshotsForSpace',
  },
  {
    rpc: 'list_materials_for_entity',
    sends: ['p_entity_type', 'p_entity_id', 'p_material_types', 'p_limit', 'p_offset'],
    source: 'material.service.ts:listForEntity',
  },
  {
    rpc: 'list_materials_for_space',
    sends: [
      'p_space_id',
      'p_material_types',
      'p_entity_type',
      'p_entity_id',
      'p_limit',
      'p_offset',
    ],
    source: 'material.service.ts:listForSpace',
  },
  {
    rpc: 'list_primary_intelligence',
    sends: [
      'p_space_id',
      'p_entity_types',
      'p_author_id',
      'p_since',
      'p_query',
      'p_referencing_entity_type',
      'p_referencing_entity_id',
      'p_limit',
      'p_offset',
    ],
    source: 'primary-intelligence.service.ts:list',
  },
  {
    rpc: 'list_recent_materials_for_space',
    sends: ['p_space_id', 'p_limit'],
    source: 'material.service.ts:listRecentForSpace',
  },
  {
    rpc: 'list_space_members',
    sends: ['p_space_id'],
    source: 'space.service.ts:listMembers',
  },
  {
    rpc: 'list_tenant_members',
    sends: ['p_tenant_id'],
    source: 'tenant.service.ts:listMembers',
  },
  {
    rpc: 'lookup_user_by_email',
    sends: ['p_email'],
    source:
      'agency.service.ts:lookupUserByEmail + super-admin.service.ts:lookupUserByEmail (identical args)',
  },
  {
    rpc: 'palette_empty_state',
    sends: ['p_space_id'],
    source: 'palette.service.ts:loadEmptyState',
  },
  {
    rpc: 'palette_set_pinned',
    sends: ['p_space_id', 'p_kind', 'p_entity_id', 'p_position'],
    source: 'palette-pin.service.ts:pin',
  },
  {
    rpc: 'palette_touch_recent',
    sends: ['p_space_id', 'p_kind', 'p_entity_id'],
    source: 'palette-recents.service.ts:touch',
  },
  {
    rpc: 'palette_unpin',
    sends: ['p_space_id', 'p_kind', 'p_entity_id'],
    source: 'palette-pin.service.ts:unpin',
  },
  {
    rpc: 'permanently_delete_space',
    sends: ['p_space_id'],
    source: 'space.service.ts:permanentlyDeleteSpace',
  },
  {
    rpc: 'platform_admin_set_ai_enabled',
    sends: ['p_tenant_id', 'p_enabled', 'p_reason'],
    source: 'super-admin-ai-usage.component.ts:857 (executeToggle)',
  },
  {
    rpc: 'platform_admin_update_ai_config',
    sends: [
      'p_tenant_id',
      'p_reason',
      'p_ai_model',
      'p_daily_token_cap',
      'p_per_user_rate_per_min',
      'p_per_user_rate_per_hour',
    ],
    source: 'super-admin-ai-usage.component.ts:909 (saveLimits)',
  },
  {
    rpc: 'preview_asset_delete',
    sends: ['p_asset_id'],
    source: 'asset.service.ts:previewDelete',
  },
  {
    rpc: 'preview_company_delete',
    sends: ['p_company_id'],
    source: 'company.service.ts:previewDelete',
  },
  {
    rpc: 'preview_trial_delete',
    sends: ['p_trial_id'],
    source: 'trial.service.ts:previewDelete',
  },
  {
    rpc: 'provision_agency',
    sends: ['p_name', 'p_slug', 'p_subdomain', 'p_owner_email', 'p_contact_email'],
    source: 'super-admin.service.ts:provisionAgency',
  },
  {
    rpc: 'provision_tenant',
    sends: ['p_agency_id', 'p_name', 'p_subdomain', 'p_brand'],
    source: 'agency.service.ts:provisionTenant',
  },
  {
    rpc: 'purge_primary_intelligence',
    sends: ['p_id', 'p_confirmation', 'p_purge_anchor'],
    source: 'primary-intelligence.service.ts:purge',
  },
  {
    rpc: 'register_custom_domain',
    sends: ['p_tenant_id', 'p_custom_domain'],
    source: 'super-admin.service.ts:registerCustomDomain',
  },
  {
    rpc: 'register_material',
    sends: [
      'p_space_id',
      'p_file_path',
      'p_file_name',
      'p_file_size_bytes',
      'p_mime_type',
      'p_material_type',
      'p_title',
      'p_links',
    ],
    source: 'material.service.ts:registerMaterial',
  },
  {
    rpc: 'release_retired_hostname',
    sends: ['p_hostname'],
    source: 'super-admin.service.ts:releaseRetiredHostname',
  },
  {
    rpc: 'reorder_intelligence',
    sends: ['p_space_id', 'p_entity_type', 'p_entity_id', 'p_anchor_ids'],
    source: 'primary-intelligence.service.ts:reorder',
  },
  {
    rpc: 'restore_space',
    sends: ['p_space_id'],
    source: 'space.service.ts:restoreSpace',
  },
  {
    rpc: 'search_palette',
    sends: ['p_space_id', 'p_query', 'p_kind', 'p_limit'],
    source: 'palette.service.ts:search',
  },
  {
    rpc: 'seed_demo_data',
    sends: ['p_space_id'],
    source: 'dashboard.service.ts:seedDemoData',
  },
  {
    rpc: 'self_join_tenant',
    sends: ['p_subdomain'],
    source: 'tenant.service.ts:selfJoinTenant',
  },
  {
    rpc: 'set_intelligence_lead',
    sends: ['p_anchor_id'],
    source: 'primary-intelligence.service.ts:setLead',
  },
  {
    rpc: 'set_trial_assets',
    sends: ['p_trial_id', 'p_asset_ids', 'p_primary_asset_id'],
    source: 'trial.service.ts:setAssets',
  },
  {
    rpc: 'set_trial_indications',
    sends: ['p_trial_id', 'p_indication_ids'],
    source: 'trial.service.ts:setIndications',
  },
  {
    rpc: 'tenant_owner_update_ai_config',
    sends: ['p_tenant_id', 'p_ai_enabled'],
    source: 'tenant-settings.component.ts:814 (onAiEnabledToggle)',
  },
  {
    rpc: 'update_agency_branding',
    sends: ['p_agency_id', 'p_branding'],
    source: 'agency.service.ts:updateAgencyBranding',
  },
  {
    rpc: 'update_asset_mechanisms',
    sends: ['p_asset_id', 'p_moa_ids'],
    source: 'asset.service.ts:setMechanisms',
  },
  {
    rpc: 'update_asset_routes',
    sends: ['p_asset_id', 'p_roa_ids'],
    source: 'asset.service.ts:setRoutes',
  },
  {
    rpc: 'update_event',
    sends: [
      'p_event_id',
      'p_event_type_id',
      'p_anchor_type',
      'p_anchor_id',
      'p_title',
      'p_event_date',
      'p_projection',
      'p_date_precision',
      'p_end_date',
      'p_end_date_precision',
      'p_is_ongoing',
      'p_description',
      'p_significance',
      'p_visibility',
      'p_no_longer_expected',
    ],
    sometimes: ['p_metadata'],
    source: 'event.service.ts:updateEvent()',
  },
  {
    rpc: 'update_event_links',
    sends: ['p_event_id', 'p_linked_event_ids'],
    source: 'event.service.ts:updateLinks()',
  },
  {
    rpc: 'update_event_sources',
    sends: ['p_event_id', 'p_urls', 'p_labels'],
    source: 'event.service.ts:updateSources()',
  },
  {
    rpc: 'update_material',
    sends: ['p_id', 'p_title', 'p_material_type', 'p_links'],
    source: 'material.service.ts:update',
  },
  {
    rpc: 'update_space_field_visibility',
    sends: ['p_space_id', 'p_visibility'],
    source: 'space-field-visibility.service.ts:update',
  },
  {
    rpc: 'update_space_show_preclinical',
    sends: ['p_space_id', 'p_show'],
    source: 'space-settings.service.ts:setShowPreclinical',
  },
  {
    rpc: 'update_tenant_access',
    sends: ['p_tenant_id', 'p_settings'],
    source: 'tenant.service.ts:updateTenantAccess',
  },
  {
    rpc: 'update_tenant_branding',
    sends: ['p_tenant_id', 'p_branding'],
    source: 'agency.service.ts:updateTenantBranding',
  },
  {
    rpc: 'upsert_change_event_annotation',
    sends: ['p_change_event_id', 'p_body'],
    source: 'annotation.service.ts:upsert()',
  },
  {
    rpc: 'upsert_primary_intelligence',
    sends: [
      'p_id',
      'p_anchor_id',
      'p_space_id',
      'p_entity_type',
      'p_entity_id',
      'p_headline',
      'p_summary_md',
      'p_implications_md',
      'p_state',
      'p_change_note',
      'p_links',
    ],
    source: 'primary-intelligence.service.ts:upsert',
  },
  {
    rpc: 'withdraw_primary_intelligence',
    sends: ['p_id', 'p_change_note'],
    source: 'primary-intelligence.service.ts:withdraw',
  },
];
