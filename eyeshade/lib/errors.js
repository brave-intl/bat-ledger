module.exports = {
  isConflict
}

function isConflict (err) {
  return err && err.code === '23505'
}
