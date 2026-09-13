export async function updateOwnProfile(Model, userId, changes) {
  const filter = { user: userId };
  const update = { $set: changes };
  const options = {
    upsert: true,
    returnDocument: 'after',
    runValidators: true,
    setDefaultsOnInsert: true,
  };
  try {
    return await Model.findOneAndUpdate(filter, update, options);
  } catch (error) {
    // Simultaneous first saves can race on the unique owner index.
    if (error.code !== 11000) throw error;
    return Model.findOneAndUpdate(filter, update, {
      ...options,
      upsert: false,
    });
  }
}
