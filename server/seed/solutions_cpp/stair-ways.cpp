#include <bits/stdc++.h>
using namespace std;
typedef long long ll;
typedef unsigned long long ull;

const ll MOD = 1000000007;
int main() {
    ll n; cin >> n;
    ll a = 1, b = 1;
    for (ll i = 0; i < n - 1; i++) { ll c = (a + b) % MOD; a = b; b = c; }
    cout << b << "\n";
}
