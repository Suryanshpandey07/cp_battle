#include <bits/stdc++.h>
using namespace std;
typedef long long ll;
typedef unsigned long long ull;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int n; cin >> n;
    vector<ll> a(n);
    ll s = 0;
    for (auto& v : a) { cin >> v; s ^= v; }
    ll low = s & -s, x = 0;
    for (ll v : a) if (v & low) x ^= v;
    ll y = s ^ x;
    cout << min(x, y) << " " << max(x, y) << "\n";
}
