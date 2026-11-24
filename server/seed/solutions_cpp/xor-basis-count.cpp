#include <bits/stdc++.h>
using namespace std;
typedef long long ll;
typedef unsigned long long ull;

const ll MOD = 1000000007;
int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int n; cin >> n;
    ull basis[60] = {};
    int rank = 0;
    for (int i = 0; i < n && rank < 60; i++) {
        ull v; cin >> v;
        for (int b = 59; b >= 0; b--) {
            if (!(v >> b & 1)) continue;
            if (!basis[b]) { basis[b] = v; rank++; break; }
            v ^= basis[b];
        }
    }
    ll ans = 1;
    for (int i = 0; i < rank; i++) ans = ans * 2 % MOD;
    cout << ans << "\n";
}
