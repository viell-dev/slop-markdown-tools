Setup guide
===========

This guide takes a new board from the box to its first published reading. Allow about ten minutes, most of which is waiting for the sensors to settle.

1. Connect the board over USB and wait until the status light stops blinking. A steady light means the sensors have settled and the readings can be trusted.
2. Copy `station.toml` to the board and set the publishing interval:

   ```toml
   [publish]
   interval_seconds = 60   # Lines in code blocks are never wrapped, however long they are.
   ```

3. Open the page listed under [Usage](../README.md#usage) and check that all three readings appear.

Readings that look wrong are usually a unit problem; the [reference](reference.md) lists the unit of every sensor.
