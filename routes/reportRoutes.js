function registerReportRoutes(app, deps = {}) {
  const {
    Account,
    buildAccountProviderFilter,
    generateExcelReport,
    getReportData,
    normalizeCampaignDate,
    todayStr,
    withUserFilter
  } = deps;

function renderPublicPolicyPage({ title, body }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title}</title>
    <style>
      body { font-family: Arial, sans-serif; color: #102033; line-height: 1.6; margin: 0; background: #f6f8fb; }
      main { max-width: 760px; margin: 40px auto; padding: 32px; background: #fff; border: 1px solid #d8e1ec; border-radius: 8px; }
      h1 { margin-top: 0; font-size: 28px; }
      h2 { margin-top: 28px; font-size: 18px; }
      a { color: #1664d9; }
    </style>
  </head>
  <body>
    <main>
      <h1>${title}</h1>
      ${body}
      <p><strong>Last updated:</strong> May 1, 2026</p>
    </main>
  </body>
</html>`;
}

app.get('/privacy-policy', (req, res) => {
  res.type('html').send(renderPublicPolicyPage({
    title: 'Privacy Policy',
    body: `
      <p>ads-systems uses Meta APIs to help authorized users manage advertising accounts, campaigns, pages, posts, and related performance data.</p>
      <h2>Information We Access</h2>
      <p>When you connect Facebook, we may access information authorized by you through Meta permissions, including profile information, ad account data, campaign data, page data, post data, and performance insights.</p>
      <h2>How We Use Information</h2>
      <p>We use this information only to provide app functionality such as campaign reporting, campaign creation, campaign status updates, and ad performance monitoring.</p>
      <h2>Sharing</h2>
      <p>We do not sell user data. We do not share user data with third parties except where required to operate the app or comply with law.</p>
      <h2>Data Deletion</h2>
      <p>You can request deletion of app-related data by following our <a href="/data-deletion">User Data Deletion Instructions</a>.</p>
    `
  }));
});

app.get('/data-deletion', (req, res) => {
  res.type('html').send(renderPublicPolicyPage({
    title: 'User Data Deletion Instructions',
    body: `
      <p>If you want to delete data associated with ads-systems, remove the app from your Facebook account and contact the app administrator.</p>
      <h2>Remove the App from Facebook</h2>
      <ol>
        <li>Go to Facebook Settings & Privacy.</li>
        <li>Open Settings.</li>
        <li>Go to Apps and Websites.</li>
        <li>Find ads-systems.</li>
        <li>Select Remove to disconnect the app.</li>
      </ol>
      <h2>Request Data Deletion</h2>
      <p>To request deletion of data stored by this app, contact the app administrator and include your Facebook name, Facebook user ID if available, and the ad account or page connected to the app.</p>
      <p>We will delete related app data unless retention is required by law or operational records are needed for security and audit purposes.</p>
    `
  }));
});

// ─── REPORT DATA (JSON) ─────────────────────────────────────
app.get('/api/reports/data', async (req, res) => {
  try {
    if (!req.currentUser?._id) return res.status(401).json({ error: 'Unauthorized' });
    const targetDate = normalizeCampaignDate(req.query.date || todayStr());
    if (!targetDate) return res.status(400).json({ error: 'Invalid date' });

    const accounts = await Account.find(withUserFilter(req, buildAccountProviderFilter('shopee')))
      .select('_id name adAccountId').lean();
    if (!accounts.length) return res.status(404).json({ error: 'Không tìm thấy tài khoản Shopee nào' });

    const accountIds = accounts.map(a => a._id);
    const data = await getReportData({ ownerUserId: req.currentUser._id, targetDate, accountIds });
    res.json(data);
  } catch (err) {
    console.error('[Report] Error fetching report data:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── EXCEL REPORT GENERATION ────────────────────────────────
app.get('/api/reports/generate-excel', async (req, res) => {
  try {
    if (!req.currentUser?._id) return res.status(401).json({ error: 'Unauthorized' });

    const targetDate = normalizeCampaignDate(req.query.date || todayStr());
    if (!targetDate) return res.status(400).json({ error: 'Invalid date' });

    const accounts = await Account.find(withUserFilter(req, buildAccountProviderFilter('shopee')))
      .select('_id name adAccountId').lean();

    if (!accounts.length) {
      return res.status(404).json({ error: 'Không tìm thấy tài khoản Shopee nào' });
    }

    const accountIds = accounts.map(a => a._id);
    const buffer = await generateExcelReport({
      ownerUserId: req.currentUser._id,
      targetDate,
      accountIds,
    });

    const [, mm, dd] = targetDate.split('-');
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="BaoCao_Shopee_${dd}_${mm}.xlsx"`,
      'Content-Length': buffer.length,
    });
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('[Report] Error generating Excel report:', err);
    res.status(500).json({ error: err.message });
  }
});
// ────────────────────────────────────────────────────────────
}

module.exports = { registerReportRoutes };
