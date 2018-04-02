# savvy-api

## Troubleshooting

### Node version

This uses async functions so requires Node v7.6 or higher. This might be the issue if you get an error like this:

```
exports.acceptRequest = async function(req) {
                              ^^^^^^^^
SyntaxError: Unexpected token function
...
```

If you have `nvm` installed you can try `nvm use 8`, where you replace 8 with a version of node that you have installed and is 7.6 or higher. To install a version of node you could try `brew install node@8`, replacing 8 with another number if you prefer.
