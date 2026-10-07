'use strict';

// Chi so phu cua Meta (Facebook) cho bang Dashboard. Luu chung trong Campaign.metaExtra
// (moi ngay mot dong), API cong don theo khoang ngay; chi phi / ty le tinh o client.

// Truong insights can lay them (ngoai cac truong co san trong fetchAccountInsightsInRange)
const META_EXTRA_INSIGHT_FIELDS = [
  'social_spend',
  'outbound_clicks',
  'action_values',
  'estimated_ad_recallers',
  'video_play_actions',
  'video_thruplay_watched_actions',
  'video_p25_watched_actions',
  'video_p50_watched_actions',
  'video_p75_watched_actions',
  'video_p95_watched_actions',
  'video_p100_watched_actions'
];

// key -> { source: truong insights chua mang action, types: action_type ung vien (lay gia tri lon nhat
// vi Meta tra trung lap nhieu bien the: omni_, onsite_, offsite_...) } hoac { field } la so le.
const META_EXTRA_METRICS = {
  socialSpend: { field: 'social_spend' },
  estimatedAdRecallers: { field: 'estimated_ad_recallers' },
  outboundClicks: { source: 'outbound_clicks', types: ['outbound_click'] },
  purchaseValue: {
    source: 'action_values',
    types: ['omni_purchase', 'purchase', 'onsite_conversion.purchase', 'offsite_conversion.fb_pixel_purchase', 'onsite_web_purchase', 'onsite_web_app_purchase']
  },
  videoPlays: { source: 'video_play_actions', types: ['video_view'] },
  thruplays: { source: 'video_thruplay_watched_actions', types: ['video_view'] },
  videoP25: { source: 'video_p25_watched_actions', types: ['video_view'] },
  videoP50: { source: 'video_p50_watched_actions', types: ['video_view'] },
  videoP75: { source: 'video_p75_watched_actions', types: ['video_view'] },
  videoP95: { source: 'video_p95_watched_actions', types: ['video_view'] },
  videoP100: { source: 'video_p100_watched_actions', types: ['video_view'] },
  video3s: { source: 'actions', types: ['video_view'] },
  photoViews: { source: 'actions', types: ['photo_view'] },
  pageLikes: { source: 'actions', types: ['like'] },
  pageEngagement: { source: 'actions', types: ['page_engagement'] },
  postReactions: { source: 'actions', types: ['post_reaction'] },
  postComments: { source: 'actions', types: ['comment'] },
  postShares: { source: 'actions', types: ['post'] },
  postSaves: { source: 'actions', types: ['onsite_conversion.post_save'] },
  messagingStarted: { source: 'actions', types: ['onsite_conversion.messaging_conversation_started_7d'] },
  messagingNewContacts: { source: 'actions', types: ['onsite_conversion.messaging_first_reply'] },
  leads: { source: 'actions', types: ['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead', 'onsite_web_lead'] },
  submitApplications: {
    source: 'actions',
    types: ['submit_application_total', 'omni_submit_application', 'offsite_conversion.fb_pixel_submit_application', 'onsite_web_submit_application']
  },
  viewContent: { source: 'actions', types: ['omni_view_content', 'view_content', 'offsite_conversion.fb_pixel_view_content', 'onsite_web_view_content'] },
  completeRegistrations: {
    source: 'actions',
    types: ['omni_complete_registration', 'complete_registration', 'offsite_conversion.fb_pixel_complete_registration', 'onsite_web_complete_registration']
  },
  addToWishlist: { source: 'actions', types: ['omni_add_to_wishlist', 'add_to_wishlist', 'offsite_conversion.fb_pixel_add_to_wishlist'] },
  customizeProduct: {
    source: 'actions',
    types: ['customize_product_total', 'omni_customize_product', 'offsite_conversion.fb_pixel_customize_product']
  },
  addToCart: {
    source: 'actions',
    types: ['omni_add_to_cart', 'add_to_cart', 'onsite_conversion.add_to_cart', 'offsite_conversion.fb_pixel_add_to_cart', 'onsite_web_add_to_cart']
  },
  contacts: { source: 'actions', types: ['contact_total', 'omni_contact', 'contact', 'offsite_conversion.fb_pixel_contact'] },
  searches: { source: 'actions', types: ['omni_search', 'search', 'offsite_conversion.fb_pixel_search', 'onsite_web_search'] },
  initiateCheckouts: {
    source: 'actions',
    types: ['omni_initiated_checkout', 'initiate_checkout', 'onsite_conversion.initiate_checkout', 'offsite_conversion.fb_pixel_initiate_checkout', 'onsite_web_initiate_checkout']
  },
  ordersCreated: { source: 'actions', types: ['onsite_conversion.messaging_order_created_v2'] },
  ordersShipped: { source: 'actions', types: ['onsite_conversion.messaging_order_shipped_v2'] }
};

const META_EXTRA_METRIC_KEYS = Object.keys(META_EXTRA_METRICS);

function toMetricNumber(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Chi giu key khac 0 (phan lon chi so = 0) cho gon DB va payload; key thieu = 0.
function getMetaExtraMetricsFromInsight(insight = {}) {
  const result = {};
  const valuesBySource = new Map();
  for (const [key, spec] of Object.entries(META_EXTRA_METRICS)) {
    let value = 0;
    if (spec.field) {
      value = toMetricNumber(insight[spec.field]);
    } else {
      // action_type -> gia tri, dung chung cho moi key cung source
      let byType = valuesBySource.get(spec.source);
      if (!byType) {
        byType = new Map();
        for (const item of Array.isArray(insight[spec.source]) ? insight[spec.source] : []) {
          const type = String(item?.action_type || '').toLowerCase();
          byType.set(type, Math.max(byType.get(type) || 0, toMetricNumber(item?.value)));
        }
        valuesBySource.set(spec.source, byType);
      }
      for (const type of spec.types) value = Math.max(value, byType.get(type) || 0);
    }
    if (value !== 0) result[key] = value;
  }
  return result;
}

function mergeMetaExtraMetrics(target = {}, source = {}) {
  for (const [key, value] of Object.entries(source || {})) {
    target[key] = toMetricNumber(target[key]) + toMetricNumber(value);
  }
  return target;
}

// Bo cac key = 0 sau khi $group cong don (tranh gui ~30 so 0 cho moi camp)
function compactMetaExtraRows(rows = []) {
  for (const row of rows) {
    if (!row?.metaExtra) continue;
    const compact = {};
    for (const [key, value] of Object.entries(row.metaExtra)) {
      if (Number(value) !== 0) compact[key] = value;
    }
    row.metaExtra = compact;
  }
  return rows;
}

// $group: metaExtra_<key> = tong theo ngay; $project: gom lai thanh object metaExtra
function buildMetaExtraGroupFields() {
  return Object.fromEntries(META_EXTRA_METRIC_KEYS.map(key => [`metaExtra_${key}`, { $sum: `$metaExtra.${key}` }]));
}

function buildMetaExtraProjectField() {
  return Object.fromEntries(META_EXTRA_METRIC_KEYS.map(key => [key, `$metaExtra_${key}`]));
}

module.exports = {
  META_EXTRA_INSIGHT_FIELDS,
  META_EXTRA_METRIC_KEYS,
  getMetaExtraMetricsFromInsight,
  mergeMetaExtraMetrics,
  compactMetaExtraRows,
  buildMetaExtraGroupFields,
  buildMetaExtraProjectField
};
