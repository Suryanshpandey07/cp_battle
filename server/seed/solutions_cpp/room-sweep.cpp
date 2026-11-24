#include <bits/stdc++.h>
using namespace std;
typedef long long ll;
typedef unsigned long long ull;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int n; cin >> n;
    vector<pair<ll, int>> ev;
    ev.reserve(2 * n);
    for (int i = 0; i < n; i++) {
        ll s, e; cin >> s >> e;
        ev.push_back({s, 1});
        ev.push_back({e, -1});  // ends sort before starts at the same time
    }
    sort(ev.begin(), ev.end());
    int cur = 0, best = 0;
    for (auto& [t, d] : ev) { cur += d; best = max(best, cur); }
    cout << best << "\n";
}
