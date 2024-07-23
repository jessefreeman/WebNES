/*
This file is part of WebNES.

WebNES is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

WebNES is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with WebNES.  If not, see <http://www.gnu.org/licenses/>.
*/

this.Nes = this.Nes || {};

("use strict");

var gppu;
var gmapper;
var ginput;
var gapu;

var memory = function (mainboard) {
  var that = this;
  this.mainboard = mainboard;
  this.mainboard.connect("reset", function (cold) {
    that.reset(cold);
  });
  this.ramPage = new Int32Array(0x800);
};

memory.prototype.reset = function (cold) {
  if (cold) {
    // these memory locations are set to various values on power-up
    for (var i = 0; i < this.ramPage.length; ++i) this.ramPage[i] = 0xff;
    this.ramPage[0x0008] = 0xf7;
    this.ramPage[0x0009] = 0xef;
    this.ramPage[0x000a] = 0xdf;
    this.ramPage[0x000f] = 0xbf;
  }
  gppu = window.ppu;
  gmapper = this.mainboard.cart.memoryMapper;
  ginput = this.mainboard.inputdevicebus;
  gapu = this.mainboard.apu;
  this.watchList = {
    0x075a: "Player Lives",
    0x07ed: "Coins",
    0x075f: "World Number",
    0x0760: "Level Number",
    0x071c: "Horizontal Scroll",
    0x000e: "Game Mode State", // Mode of the game, such as normal, game over, etc.
    0x001d: "Jumping State", // 0 when Mario is on the ground, nonzero during a jump.
    0x0086: "Vertical Velocity", // Vertical speed, changes when jumping or falling.
    0x00b5: "Mario State", // 0x00 small, 0x01 big, 0x02 fire Mario
    0x0756: "Time Units",
    0x0757: "Time Tens",
    0x0758: "Time Hundreds",
    0x0747: "Enemy State Array", // State of various enemies on screen.
    0x0433: "Sprite X Positions",
    0x0434: "Sprite Y Positions",
    0x0700: "Score Units",
    0x0701: "Score Tens",
    0x0702: "Score Hundreds",
    0x0703: "Score Thousands",
    0x0704: "Score Ten Thousands",
    0x0705: "Score Hundred Thousands",
    0x0706: "Score Millions",
    0x0045: "Power-Up State" // Indicates whether a power-up is active.
  };
};

memory.prototype.read8 = function (offset) {
  //ASSERT_NUMBER( offset );
  return this._properRead8(offset & 0xffff) & 0xff;
};

memory.prototype._readRegister4000 = function (offset) {
  var offset4000 = offset & 0x1fe0;
  if (offset4000 === 0) {
    // testing top 11 bits - if it's zero it's between 4000 -> 4020
    if (offset === 0x4016 || offset === 0x4017) {
      //				return 0;
      return ginput.readFromRegister(offset);
    } else {
      return 0;
      //			return gapu.readFromRegister( offset ) | 0;
    }
  } else {
    return gmapper.read8EXRam(offset);
    //			return 0;
  }
  return 0;
};

memory.prototype._properRead8 = function (offset) {
  // Faster: Top 3 bits are equal to 0x2000 for inbetween 2000 -> 4000, equal to 0 for < 2000 and so on
  var topbits = offset & 0xe000;
  var bot3 = offset & 0x7;
  var rampageOffset = offset & 0x7ff;
  switch (topbits) {
    case 0: // address is within RAM boundaries, account for 4x mirroring
      return TYPED_ARRAY_GET_INT32(this.ramPage, rampageOffset);
    case 0x2000: // IS_INT_BETWEEN( offset, 0x2000, 0x4000 )
      return gppu.readFromRegister(bot3);
    case 0x4000:
      return this._readRegister4000(offset);
    case 0x6000: // IS_INT_BETWEEN( offset, 0x6000, 0x8000 )
      return gmapper.read8SRam(offset);
    default: // IS_INT_BETWEEN( offset, 0x8000, 0x10000 )
      return gmapper.read8PrgRom(offset);
  }
  return 0;
};

memory.prototype.read16NoZeroPageWrap = function (offset) {
  return this.read8(offset) | (this.read8(offset + 1) << 8);
};

memory.prototype.monitorMemoryWrite = function (address, value) {
  if (this.watchList.hasOwnProperty(address)) {
    console.log(this.watchList[address] + " changed to: " + value);
  }
};

memory.prototype.write8 = function (offset, data) {
  // Call monitoring function on every write operation
  this.monitorMemoryWrite(offset, data);

  // Existing switch statement handles different memory regions
  switch (offset & 0xe000) {
    case 0: // Address is within RAM boundaries, account for 4x mirroring
      TYPED_ARRAY_SET_INT32(this.ramPage, offset & 0x7ff, data);
      break;
    case 0x2000: // Address is within PPU register range
      this.mainboard.ppu.writeToRegister(offset & 0x07, data);
      break;
    case 0x4000: // Address could be APU or other system registers
      if ((offset & 0x1fe0) === 0) {
        // Check if it's between 4000 -> 4020
        switch (offset) {
          case 0x4014: // Sprite DMA access
            this.mainboard.ppu.writeToSpriteDMARegister(data);
            break;
          case 0x4016: // Input
          case 0x4017:
            this.mainboard.inputdevicebus.writeToRegister(offset, data);
            break;
        }
        // APU and possibly other system registers
        this.mainboard.apu.writeToRegister(offset, data);
      } else {
        // Extended RAM or similar
        this.mainboard.cart.memoryMapper.write8EXRam(offset, data);
      }
      break;
    case 0x6000: // Address is within SRAM range
      this.mainboard.cart.memoryMapper.write8SRam(offset, data);
      break;
    case 0x8000: // Address is within PRG-ROM range, usually mapped to a ROM bank
      // Typically, writes to this range are handled by mappers for bank switching
      this.mainboard.cart.memoryMapper.write8PrgRom(offset, data);
      break;
  }
};

memory.prototype.saveState = function () {
  return { ramPage: Nes.uintArrayToString(this.ramPage) };
};

memory.prototype.loadState = function (state) {
  this.ramPage = Nes.stringToUintArray(state.ramPage);
};

Nes.memory = memory;
