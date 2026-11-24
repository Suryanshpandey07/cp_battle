#include <bits/stdc++.h>
using namespace std;
typedef long long ll;
typedef unsigned long long ull;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int n, q; cin >> n >> q;
    vector<ll> a(n);
    for (auto& v : a) cin >> v;
    string out;
    while (q--) {
        ll x; cin >> x;
        out += to_string(lower_bound(a.begin(), a.end(), x) - a.begin()) + "\n";
    }
    cout << out;
}
