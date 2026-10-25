/** Plain CSS seeded as `src/styles/*.css` — no framework, no preprocessor. */

export const GLOBAL_CSS = `* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: #f6f7f9;
  color: #1c2330;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  font-size: 15px;
  line-height: 1.45;
}

a {
  color: #2456c4;
  text-decoration: none;
}

a:hover {
  text-decoration: underline;
}

.topbar {
  align-items: center;
  background: #1c2330;
  color: #fff;
  display: flex;
  gap: 28px;
  padding: 12px 24px;
}

.brand {
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.topbar nav {
  display: flex;
  gap: 16px;
}

.topbar nav a {
  color: rgba(255, 255, 255, 0.72);
  padding: 4px 2px;
}

.topbar nav a.active {
  border-bottom: 2px solid #6ea8ff;
  color: #fff;
}

.page {
  margin: 0 auto;
  max-width: 960px;
  padding: 24px;
}

h1 {
  font-size: 24px;
  margin: 0 0 18px;
}

h2 {
  font-size: 18px;
  margin: 28px 0 10px;
}

.stat-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
}

.stat-card {
  background: #fff;
  border: 1px solid #e2e5ea;
  border-radius: 8px;
  display: grid;
  gap: 6px;
  justify-items: start;
  padding: 14px 16px;
}

.stat-card__value {
  font-size: 26px;
  font-weight: 700;
}

.stat-card--total .stat-card__label {
  color: #6b7280;
  font-size: 12px;
  text-transform: uppercase;
}

.recent-list {
  display: grid;
  gap: 8px;
  list-style: none;
  margin: 0;
  padding: 0;
}

.recent-list li {
  background: #fff;
  border: 1px solid #e2e5ea;
  border-radius: 8px;
  display: flex;
  justify-content: space-between;
  padding: 10px 14px;
}

.recent-list__meta {
  color: #6b7280;
  font-size: 13px;
}
`;

export const ISSUES_CSS = `.filter-bar {
  align-items: end;
  display: flex;
  gap: 14px;
  margin-bottom: 12px;
}

.filter-bar label {
  display: grid;
  font-size: 13px;
  gap: 4px;
}

.filter-bar select {
  min-width: 140px;
  padding: 5px 6px;
}

.filter-bar button {
  background: #fff;
  border: 1px solid #c9ced6;
  border-radius: 6px;
  cursor: pointer;
  padding: 6px 12px;
}

.result-count {
  color: #6b7280;
  font-size: 13px;
  margin: 0 0 12px;
}

.issue-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
}

.issue-card {
  background: #fff;
  border: 1px solid #e2e5ea;
  border-radius: 8px;
  color: inherit;
  display: grid;
  gap: 8px;
  padding: 14px;
}

.issue-card:hover {
  border-color: #9db4dd;
  text-decoration: none;
}

.issue-card h3 {
  font-size: 15px;
  margin: 0;
}

.issue-card__row {
  align-items: center;
  display: flex;
  justify-content: space-between;
}

.issue-card__id {
  color: #6b7280;
  font-size: 13px;
}

.issue-card__foot {
  color: #6b7280;
  font-size: 13px;
}

.issue-card__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tag {
  background: #eef1f6;
  border-radius: 10px;
  color: #45506b;
  font-size: 12px;
  padding: 2px 8px;
}

.badge {
  border-radius: 10px;
  font-size: 12px;
  font-weight: 600;
  padding: 2px 10px;
}

.badge--open {
  background: #e8f0fe;
  color: #1b4dad;
}

.badge--in-progress {
  background: #fef3dd;
  color: #92600a;
}

.badge--resolved {
  background: #e3f6e8;
  color: #1e7a37;
}

.badge--closed {
  background: #ececf0;
  color: #5b6472;
}

.issue-detail .back-link {
  display: inline-block;
  margin-bottom: 14px;
}

.issue-detail__head {
  align-items: center;
  display: flex;
  gap: 12px;
}

.issue-detail__head h1 {
  margin: 0;
}

.issue-detail__id {
  color: #6b7280;
  font-weight: 400;
}

.issue-detail__meta {
  display: grid;
  gap: 4px 18px;
  grid-template-columns: max-content 1fr;
  margin: 18px 0;
}

.issue-detail__meta dt {
  color: #6b7280;
}

.issue-detail__meta dd {
  display: flex;
  gap: 6px;
  margin: 0;
}

.issue-detail__body {
  background: #fff;
  border: 1px solid #e2e5ea;
  border-radius: 8px;
  max-width: 640px;
  padding: 16px;
}

.settings form {
  display: grid;
  gap: 14px;
  max-width: 380px;
}

.settings label {
  display: grid;
  font-size: 14px;
  gap: 4px;
}

.settings input[type='text'],
.settings input:not([type]),
.settings select {
  padding: 6px 8px;
}

.settings__toggle {
  align-items: center;
  display: flex;
  gap: 8px;
}

.settings__note {
  color: #6b7280;
  font-size: 13px;
  margin-top: 18px;
}
`;
