// Cot chi so phu cua Meta tren Dashboard. So lieu tho nam trong campaign.metaExtra
// (backend: utils/metaExtraMetrics.js); chi phi / ty le tinh tu spend, impressions, reach...
// value() tra null khi khong co du lieu (vd. dang loc theo gio) -> hien "-".

const extra = (key) => (campaign) => (campaign.metaExtra ? Number(campaign.metaExtra[key] || 0) : null);
const ratio = (numerator, denominator, scale = 1) => (campaign) => {
  const top = numerator(campaign);
  const bottom = denominator(campaign);
  if (top === null || bottom === null) return null;
  return bottom > 0 ? (top / bottom) * scale : 0;
};
const spend = (campaign) => Number(campaign.spend || 0);
const impressions = (campaign) => Number(campaign.impressions || 0);
const reach = (campaign) => (campaign.reachUnavailable ? null : Number(campaign.reach || 0));
const engagements = (campaign) => Number(campaign.engagements || 0);
const linkClicks = (campaign) => Number(campaign.linkClicks || 0);
const metaOrders = (campaign) => Number(campaign.metaOrders || 0);

// format: number | vnd | percent
export const META_EXTRA_COLUMNS = [
  // Cai dat
  { id: 'mxSocialSpend', label: 'Social spend', group: 'settings', format: 'vnd', value: extra('socialSpend') },

  // Hieu qua
  { id: 'mxPurchaseValue', label: 'Giá trị chuyển đổi từ lượt mua', group: 'performance', format: 'vnd', value: extra('purchaseValue') },
  { id: 'mxEstimatedAdRecallers', label: 'Độ cải thiện khả năng nhớ đến QC (Người)', group: 'performance', format: 'number', value: extra('estimatedAdRecallers') },
  { id: 'mxAdRecallRate', label: 'Tỷ lệ cải thiện khả năng nhớ đến QC', group: 'performance', format: 'percent', value: ratio(extra('estimatedAdRecallers'), reach) },
  { id: 'mxCostPerAdRecaller', label: 'Chi phí / người nhớ đến QC', group: 'performance', format: 'vnd', value: ratio(spend, extra('estimatedAdRecallers')) },

  // Tuong tac
  { id: 'clicks', label: 'Số lượt clicks', group: 'engagement', format: 'number', value: (campaign) => Number(campaign.clicks || 0) },
  { id: 'mxPageLikes', label: 'Lượt thích trang', group: 'engagement', format: 'number', value: extra('pageLikes') },
  { id: 'mxPageEngagement', label: 'Tương tác với trang', group: 'engagement', format: 'number', value: extra('pageEngagement') },
  { id: 'mxPostReactions', label: 'Cảm xúc về bài viết', group: 'engagement', format: 'number', value: extra('postReactions') },
  { id: 'mxPostComments', label: 'Bình luận về bài viết', group: 'engagement', format: 'number', value: extra('postComments') },
  { id: 'mxPostShares', label: 'Lượt chia sẻ bài viết', group: 'engagement', format: 'number', value: extra('postShares') },
  { id: 'mxPostSaves', label: 'Lượt lưu bài viết', group: 'engagement', format: 'number', value: extra('postSaves') },
  { id: 'mxPhotoViews', label: 'Lượt xem ảnh', group: 'engagement', format: 'number', value: extra('photoViews') },
  { id: 'mxCostPerPostEngagement', label: 'Chi phí / tương tác bài viết', group: 'engagement', format: 'vnd', value: ratio(spend, engagements) },
  { id: 'mxLinkCtr', label: 'CTR (tỷ lệ nhấp vào liên kết)', group: 'engagement', format: 'percent', value: ratio(linkClicks, impressions) },
  { id: 'mxOutboundClicks', label: 'Lượt click ra ngoài', group: 'engagement', format: 'number', value: extra('outboundClicks') },
  { id: 'mxOutboundCtr', label: 'CTR ra ngoài', group: 'engagement', format: 'percent', value: ratio(extra('outboundClicks'), impressions) },
  { id: 'mxCostPerOutboundClick', label: 'Chi phí / lượt click ra ngoài', group: 'engagement', format: 'vnd', value: ratio(spend, extra('outboundClicks')) },
  { id: 'mxMessagingStarted', label: 'Lượt bắt đầu trò chuyện qua tin nhắn', group: 'engagement', format: 'number', value: extra('messagingStarted') },
  { id: 'mxMessagingNewContacts', label: 'Người liên hệ qua tin nhắn mới', group: 'engagement', format: 'number', value: extra('messagingNewContacts') },
  { id: 'mxVideo3s', label: 'Lượt phát video tối thiểu 3 giây', group: 'engagement', format: 'number', value: extra('video3s') },
  { id: 'mxVideoPlays', label: 'Lượt phát video', group: 'engagement', format: 'number', value: extra('videoPlays') },
  { id: 'mxThruplays', label: 'ThruPlays', group: 'engagement', format: 'number', value: extra('thruplays') },
  { id: 'mxCostPerThruplay', label: 'Chi phí / ThruPlay', group: 'engagement', format: 'vnd', value: ratio(spend, extra('thruplays')) },
  { id: 'mxVideoP25', label: 'Lượt phát 25% video', group: 'engagement', format: 'number', value: extra('videoP25') },
  { id: 'mxVideoP50', label: 'Lượt phát 50% video', group: 'engagement', format: 'number', value: extra('videoP50') },
  { id: 'mxVideoP75', label: 'Lượt phát 75% video', group: 'engagement', format: 'number', value: extra('videoP75') },
  { id: 'mxVideoP95', label: 'Lượt phát 95% video', group: 'engagement', format: 'number', value: extra('videoP95') },
  { id: 'mxVideoP100', label: 'Lượt phát 100% video', group: 'engagement', format: 'number', value: extra('videoP100') },

  // Chuyen doi
  { id: 'mxCostPerPurchase', label: 'Chi phí / lượt mua', group: 'conversion', format: 'vnd', value: ratio(spend, metaOrders) },
  { id: 'mxInitiateCheckouts', label: 'Lượt bắt đầu thanh toán', group: 'conversion', format: 'number', value: extra('initiateCheckouts') },
  { id: 'mxCostPerInitiateCheckout', label: 'Chi phí / lượt bắt đầu thanh toán', group: 'conversion', format: 'vnd', value: ratio(spend, extra('initiateCheckouts')) },
  { id: 'mxAddToCart', label: 'Lượt thêm vào giỏ hàng', group: 'conversion', format: 'number', value: extra('addToCart') },
  { id: 'mxViewContent', label: 'Lượt xem nội dung', group: 'conversion', format: 'number', value: extra('viewContent') },
  { id: 'mxSearches', label: 'Tìm kiếm', group: 'conversion', format: 'number', value: extra('searches') },
  { id: 'mxLeads', label: 'Khách hàng tiềm năng', group: 'conversion', format: 'number', value: extra('leads') },
  { id: 'mxSubmitApplications', label: 'Lượt gửi đơn', group: 'conversion', format: 'number', value: extra('submitApplications') },
  { id: 'mxCompleteRegistrations', label: 'Lượt đăng ký', group: 'conversion', format: 'number', value: extra('completeRegistrations') },
  { id: 'mxAddToWishlist', label: 'Lượt thêm vào danh sách mong ước', group: 'conversion', format: 'number', value: extra('addToWishlist') },
  { id: 'mxCustomizeProduct', label: 'Lượt tùy chỉnh sản phẩm', group: 'conversion', format: 'number', value: extra('customizeProduct') },
  { id: 'mxContacts', label: 'Người liên hệ', group: 'conversion', format: 'number', value: extra('contacts') },
  { id: 'mxOrdersCreated', label: 'Đơn đặt hàng đã tạo', group: 'conversion', format: 'number', value: extra('ordersCreated') },
  { id: 'mxOrdersShipped', label: 'Đơn đặt hàng đã vận chuyển', group: 'conversion', format: 'number', value: extra('ordersShipped') }
];

export const META_EXTRA_COLUMN_BY_ID = new Map(META_EXTRA_COLUMNS.map(column => [column.id, column]));
