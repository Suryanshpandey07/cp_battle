#include <bits/stdc++.h>
using namespace std;
typedef long long ll;
typedef unsigned long long ull;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int n; cin >> n;
    vector<ll> a(n);
    for (auto& v : a) cin >> v;
    ll ans = 0, mask = 0;
    for (int b = 29; b >= 0; b--) {
        mask |= 1LL << b;
        unordered_set<ll> pre;
        pre.reserve(n * 2);
        for (ll v : a) pre.insert(v & mask);
        ll cand = ans | (1LL << b);
        for (ll p : pre) if (pre.count(cand ^ p)) { ans = cand; break; }
    }
    cout << ans << "\n";
}
