#include <bits/stdc++.h>
using namespace std;
typedef long long ll;
typedef unsigned long long ull;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int n; ll k; cin >> n >> k;
    vector<ll> w(n);
    ll lo = 0, hi = 0;
    for (auto& x : w) { cin >> x; lo = max(lo, x); hi += x; }
    auto carts = [&](ll cap) {
        ll used = 1, cur = 0;
        for (ll x : w) {
            if (cur + x > cap) { used++; cur = x; } else cur += x;
        }
        return used;
    };
    while (lo < hi) {
        ll mid = (lo + hi) / 2;
        if (carts(mid) <= k) hi = mid; else lo = mid + 1;
    }
    cout << lo << "\n";
}
