#include <bits/stdc++.h>
using namespace std;
typedef long long ll;
typedef unsigned long long ull;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int q; cin >> q;
    string out;
    while (q--) {
        ll v; cin >> v;
        out += (v > 0 && (v & (v - 1)) == 0) ? "YES\n" : "NO\n";
    }
    cout << out;
}
