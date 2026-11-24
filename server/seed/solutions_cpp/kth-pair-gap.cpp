#include <bits/stdc++.h>
using namespace std;
typedef long long ll;
typedef unsigned long long ull;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int n; ll k; cin >> n >> k;
    vector<ll> a(n);
    for (auto& v : a) cin >> v;
    sort(a.begin(), a.end());
    auto countAtMost = [&](ll d) {
        ll cnt = 0;
        for (int i = 0, j = 0; j < n; j++) {
            while (a[j] - a[i] > d) i++;
            cnt += j - i;
        }
        return cnt;
    };
    ll lo = 0, hi = a[n - 1] - a[0];
    while (lo < hi) {
        ll mid = (lo + hi) / 2;
        if (countAtMost(mid) >= k) hi = mid; else lo = mid + 1;
    }
    cout << lo << "\n";
}
