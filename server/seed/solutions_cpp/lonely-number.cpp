#include <bits/stdc++.h>
using namespace std;
typedef long long ll;
typedef unsigned long long ull;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int n; cin >> n;
    ll r = 0;
    for (int i = 0; i < n; i++) { ll x; cin >> x; r ^= x; }
    cout << r << "\n";
}
