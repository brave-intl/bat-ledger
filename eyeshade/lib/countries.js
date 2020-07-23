module.exports = {
  resolve
}

function resolve (_rows) {
  let rows = _rows
  // if this can be done in sql please fix!
  const resolver = rows.reduce((memo, { codes, id, activeAt }) => {
    return codes.reduce((memo, code) => {
      const group = { id, activeAt }
      const byCode = memo[code] = memo[code] || group
      if (!byCode.id !== id && new Date(byCode.activeAt) < new Date(activeAt)) {
        memo[code] = group
      }
      return memo
    }, memo)
  }, {})
  rows = rows.map((row) => Object.assign({}, row, {
    codes: row.codes.filter((code) => row.id === resolver[code].id)
  })).filter(({ codes }) => codes.length)
  return rows
}
