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
        ull lo, hi; cin >> lo >> hi;
        int shift = 0;
        while (lo != hi) { lo >>= 1; hi >>= 1; shift++; }
        out += to_string(lo << shift) + "\n";
    }
    cout << out;
}
