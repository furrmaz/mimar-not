// Satıcı bilgilerini sunucu ayarlarından (COMPANY_NAME, COMPANY_ADDRESS, CONTACT_EMAIL) doldurur.
fetch("api/public/config")
  .then((r) => r.json())
  .then((c) => {
    const p = c.payment || {};
    const v = { company: p.company, address: p.address, email: p.email };
    document.querySelectorAll("[data-k]").forEach((el) => { const x = v[el.dataset.k]; if (x) el.textContent = x; });
  })
  .catch(() => {});
